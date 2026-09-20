import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { WebhookController } from "./controller/WebhookController"
import { AbacatePayGateway } from "./gateway/AbacatePayGateway"
import type { IPagamentoGateway } from "./gateway/IPagamentoGateway"
import { UnauthorizedError } from "@/shared/errors"
import { errorResponseSchema } from "@/shared/errors/schema"
import { webhookAbacatePaySchema, webhookResponseSchema } from "./dto/webhook.dto"

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
