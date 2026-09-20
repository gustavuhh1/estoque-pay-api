import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { WebhookController } from "./controller/WebhookController"
import { PixController } from "./controller/PixController"
import { PagamentoController } from "./controller/PagamentoController"
import { PagamentoService } from "./service/PagamentoService"
import { AbacatePayGateway } from "./gateway/AbacatePayGateway"
import type { IPagamentoGateway } from "./gateway/IPagamentoGateway"
import { VendaPrismaRepository } from "@/modules/venda/repository/VendaPrismaRepository"
import { VendaService } from "@/modules/venda/service/VendaService"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { CaixaPrismaRepository } from "@/modules/caixa/repository/CaixaPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { UnauthorizedError } from "@/shared/errors"
import { errorResponseSchema } from "@/shared/errors/schema"
import { webhookAbacatePaySchema, webhookResponseSchema } from "./dto/webhook.dto"
import { paymentIdParamsSchema, statusCobrancaResponseSchema } from "./dto/pix.dto"
import { pagamentoResponseSchema, registrarPagamentoSchema } from "./dto/pagamento.dto"

// Mesmo padrão de augmentation inline dos middlewares (o tsconfig usa `types: []`).
declare module "fastify" {
  interface FastifyRequest {
    /** Bytes exatos do corpo. Só populado nas rotas de webhook. */
    rawBody?: Buffer
  }
}

/**
 * Módulo de pagamentos (issues #51 e #52).
 *
 * `gateway` é injetável para os testes passarem o InMemoryPagamentoGateway sem
 * chave de API e sem rede.
 */
export function pagamentoRoutes(gateway: IPagamentoGateway = new AbacatePayGateway()) {
  return async function (app: FastifyInstance) {
    const webhookController = new WebhookController()
    const pixController = new PixController(gateway)

    // Wiring do pagamento manual (#51). O VendaPrismaRepository recebe o
    // repositório de Estoque para a baixa rodar dentro da transação da venda.
    const estoqueRepository = new EstoquePrismaRepository(prisma)
    const pagamentoController = new PagamentoController(
      new PagamentoService(
        new VendaPrismaRepository(prisma, estoqueRepository),
        new VendaService(new ProdutoPrismaRepository(prisma)),
        new CaixaPrismaRepository(prisma)
      )
    )

    const route = app.withTypeProvider<ZodTypeProvider>()

    route.post(
      "/",
      {
        preHandler: [requireAuth, requireTenant],
        schema: {
          tags: ["Pagamento"],
          summary: "Registra o pagamento manual e fecha a venda",
          description:
            "RF02.1/RF02.2 + **RNF01**. Requer o header `x-estabelecimento-id`. Aceita `DINHEIRO`, `DEBITO` e `CREDITO` — **Pix não entra aqui**, porque não é confirmação manual do caixa (nasce PENDENTE e só vira PAGO pelo webhook ou polling). Em `DINHEIRO`, `valor_pago` é obrigatório e o troco volta na resposta. A venda exige **turno de caixa aberto** (409 se fechado). Os preços são relidos do banco, nunca aceitos do cliente. **Tudo numa transação**: Venda, ItemVenda, baixa de estoque e auditoria — se a baixa de um item estourar o saldo, a venda inteira volta atrás. Qualquer cargo pode vender, inclusive Caixa.",
          security: [{ cookieAuth: [] }],
          body: registrarPagamentoSchema,
          response: {
            201: pagamentoResponseSchema,
            400: errorResponseSchema.describe(
              "Dados inválidos (code: VALIDATION_ERROR), valor pago menor que o total (code: VALOR_PAGO_INSUFICIENTE) ou header de tenant ausente"
            ),
            401: errorResponseSchema.describe("Sessão ausente ou inválida"),
            403: errorResponseSchema.describe("Sem vínculo com esta loja"),
            404: errorResponseSchema.describe(
              "Produto não encontrado (code: PRODUTO_NAO_ENCONTRADO) ou inativo (code: PRODUTO_INATIVO)"
            ),
            409: errorResponseSchema.describe(
              "Caixa fechado (code: TURNO_FECHADO) ou estoque insuficiente (code: ESTOQUE_INSUFICIENTE)"
            ),
          },
        },
      },
      async (req, res) => pagamentoController.registrar(req, res)
    )

    route.get(
      "/pix/:payment_id/status",
      {
        preHandler: [requireAuth, requireTenant],
        schema: {
          tags: ["Pagamento"],
          summary: "Consulta o status de uma cobrança Pix (polling)",
          description:
            "Requer o header `x-estabelecimento-id`. Enquanto o webhook não estiver configurado, é assim que o PDV descobre que o Pix caiu: o cliente está no balcão e o caixa consulta a cada poucos segundos até `pago: true`. **Limite**: se o caixa fechar a tela antes do cliente pagar, ninguém consulta mais e a venda trava em PENDENTE — cobrir esse caso é o papel do webhook (issue própria).",
          security: [{ cookieAuth: [] }],
          params: paymentIdParamsSchema,
          response: {
            200: statusCobrancaResponseSchema,
            400: errorResponseSchema.describe(
              "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED) ou erro do provedor (code: GATEWAY_PAGAMENTO_ERRO)"
            ),
            401: errorResponseSchema.describe("Sessão ausente ou inválida"),
            403: errorResponseSchema.describe("Sem vínculo com esta loja"),
          },
        },
      },
      async (req, res) => pixController.consultarStatus(req, res)
    )

    /* ════════════════════════════════════════════════════════════════════════
     * ⚠️  ROTA DE DESENVOLVIMENTO — NÃO PODE IR ATIVA PARA A `main`  ⚠️
     * ════════════════════════════════════════════════════════════════════════
     *
     * Esta rota marca uma cobrança como PAGA sem que ninguém tenha pagado.
     * Em produção ela seria um botão de "dar baixa em venda de graça".
     *
     * >>> AO MESCLAR PARA A `main`, COMENTE O BLOCO `route.post` ABAIXO. <<<
     *
     * Ela existe para testar o fluxo do Pix em desenvolvimento sem precisar
     * escanear QR Code nem gastar dinheiro de verdade.
     *
     * Existem três camadas de proteção, e nenhuma delas dispensa as outras:
     *   1. este aviso, para o humano comentar o bloco ao subir para a main;
     *   2. a trava de `NODE_ENV` logo abaixo, que impede o registro da rota em
     *      produção mesmo se alguém esquecer de comentar (comentário é fácil
     *      de esquecer num merge; trava de código não);
     *   3. a própria AbacatePay, que recusa este endpoint com chave de
     *      produção — "only works with sandbox API keys".
     * ════════════════════════════════════════════════════════════════════════ */
    if (process.env.NODE_ENV !== "production") {
      route.post(
        "/pix/:payment_id/simular-pagamento",
        {
          preHandler: [requireAuth, requireTenant],
          schema: {
            tags: ["Pagamento"],
            summary: "[DEV] Simula o pagamento de uma cobrança Pix",
            description:
              "⚠️ **Somente desenvolvimento.** Marca a cobrança como PAGA sem pagamento real, para testar o fluxo do PDV sem escanear QR Code. Não é registrada quando `NODE_ENV=production`, e a AbacatePay recusa a chamada com chave de produção.",
            security: [{ cookieAuth: [] }],
            params: paymentIdParamsSchema,
            response: {
              200: statusCobrancaResponseSchema,
              400: errorResponseSchema.describe(
                "Header ausente ou o provedor recusou (ex: chave de produção)"
              ),
              401: errorResponseSchema.describe("Sessão ausente ou inválida"),
              403: errorResponseSchema.describe("Sem vínculo com esta loja"),
            },
          },
        },
        async (req, res) => pixController.simularPagamento(req, res)
      )
    }

    /**
     * Escopo ISOLADO para o webhook. Dois motivos:
     *
     * 1. O parser de corpo cru vale só aqui dentro. `addContentTypeParser` é
     *    encapsulado por plugin no Fastify, então as rotas de pagamento com
     *    sessão (#51/#52) ficam fora e continuam com o parser JSON padrão.
     * 2. Esta é a única rota PÚBLICA da API — sem requireAuth, sem
     *    requireTenant. Isolar deixa isso explícito.
     */
    await app.register(async (webhookScope) => {
      /**
       * Guarda os bytes crus ANTES do parse. A assinatura da AbacatePay é o
       * HMAC do corpo exatamente como trafegou; `JSON.stringify(request.body)`
       * devolveria outros bytes (ordem de chaves, espaços, escapes) e a
       * verificação falharia sempre, inclusive para requisições legítimas.
       */
      webhookScope.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (request, corpo, done) => {
          const buffer = corpo as Buffer
          request.rawBody = buffer

          try {
            done(null, JSON.parse(buffer.toString("utf8")))
          } catch {
            // Corpo ilegível: deixa seguir com objeto vazio para a rota
            // responder 401 na assinatura, e não 400 de parse. Assinatura
            // inválida é a resposta certa para lixo vindo de fora.
            done(null, {})
          }
        }
      )

      /**
       * Verificação de assinatura em `preValidation`, NÃO no handler.
       *
       * O ciclo do Fastify é: parse -> preValidation -> validation (schema) ->
       * preHandler -> handler. Se a checagem ficasse no handler, um corpo que
       * não casa com o schema sairia como 400 SEM nunca ter a origem
       * verificada — processamento antes de autenticar, e um 400 ainda
       * confirmaria ao atacante que ele passou da autenticação. Aqui, corpo
       * ilegível ou forjado morre como 401 antes de qualquer validação.
       */
      webhookScope.addHook("preValidation", async (request) => {
        if (!request.rawBody) {
          throw new UnauthorizedError(
            "Corpo cru indisponível para validação de assinatura.",
            "WEBHOOK_ASSINATURA_INVALIDA"
          )
        }

        const assinatura = request.headers["x-webhook-signature"]
        const valida = gateway.verificarAssinaturaWebhook(
          request.rawBody,
          typeof assinatura === "string" ? assinatura : undefined
        )

        if (!valida) {
          throw new UnauthorizedError(
            "Assinatura do webhook inválida.",
            "WEBHOOK_ASSINATURA_INVALIDA"
          )
        }
      })

      const route = webhookScope.withTypeProvider<ZodTypeProvider>()

      route.post(
        "/webhook/abacatepay",
        {
          schema: {
            tags: ["Pagamento"],
            summary: "Recebe as notificações de pagamento da AbacatePay",
            description:
              "RNF02. **Rota pública**: não exige sessão nem header de loja. A autenticação é a assinatura HMAC-SHA256 do corpo cru, enviada pelo provedor no header `X-Webhook-Signature` em base64. Assinatura ausente ou inválida devolve 401. Eventos que não consolidam venda devolvem 200 com `processado: false` — responder erro faria o provedor reenviar indefinidamente.",
            body: webhookAbacatePaySchema,
            response: {
              200: webhookResponseSchema,
              401: errorResponseSchema.describe(
                "Assinatura ausente ou inválida (code: WEBHOOK_ASSINATURA_INVALIDA)"
              ),
            },
          },
        },
        async (req, res) => webhookController.receber(req, res)
      )
    })
  }
}
