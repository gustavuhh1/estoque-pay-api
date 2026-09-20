import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { VendaController } from "./controller/VendaController"
import { VendaService } from "./service/VendaService"
import { VendaPrismaRepository } from "./repository/VendaPrismaRepository"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  buscarProdutoQuerySchema,
  calcularVendaSchema,
  calculoVendaResponseSchema,
  listProdutoBuscaResponseSchema,
  vendaIdParamsSchema,
  vendaResponseSchema,
} from "./dto/venda.dto"

const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

/**
 * Nota de RBAC: buscar, calcular e pagar NÃO bloqueiam por cargo — vender é o
 * trabalho do Caixa. O cancelamento (#53) é a única exceção: desfaz dinheiro e
 * mexe em estoque, então exige Owner ou Gestor.
 */
export async function vendaRoutes(app: FastifyInstance) {
  const produtoRepository = new ProdutoPrismaRepository(prisma)
  const vendaRepository = new VendaPrismaRepository(
    prisma,
    new EstoquePrismaRepository(prisma)
  )
  const vendaService = new VendaService(produtoRepository, vendaRepository)
  const vendaController = new VendaController(vendaService)

  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    "/buscar",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Venda"],
        summary: "Busca produtos para montar a venda no balcão",
        description: `RF01.1. ${TENANT_HEADER_DOC} Casa o \`termo\` de forma EXATA contra o código de barras (o leitor devolve o código inteiro) e PARCIAL contra o nome, sem diferenciar maiúsculas. **Produto inativo não aparece** — diferente do \`GET /produto\`, que é a listagem de gestão e mostra inativos de propósito.`,
        security: [{ cookieAuth: [] }],
        querystring: buscarProdutoQuerySchema,
        response: {
          200: listProdutoBuscaResponseSchema,
          400: errorResponseSchema.describe(
            "Termo vazio (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
        },
      },
    },
    async (req, res) => vendaController.buscarProdutos(req, res)
  )

  route.post(
    "/calcular",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Venda"],
        summary: "Calcula o total do carrinho sem gravar nada",
        description: `RF01.2/RF01.3 + **RN01 (baixa postergada)**. ${TENANT_HEADER_DOC} Devolve subtotal por item e o total. **Não grava absolutamente nada**: nem Venda, nem ItemVenda, nem baixa de estoque. O carrinho vive no cliente até o pagamento — é \`POST /pagamento\` que cria a venda. O preço é sempre relido do banco, nunca aceito do cliente. Aceita quantidade fracionada com até 3 casas (RN04).`,
        security: [{ cookieAuth: [] }],
        body: calcularVendaSchema,
        response: {
          200: calculoVendaResponseSchema,
          400: errorResponseSchema.describe(
            "Carrinho vazio ou quantidade inválida (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: PRODUTO_NAO_ENCONTRADO) ou inativo (code: PRODUTO_INATIVO)"
          ),
        },
      },
    },
    async (req, res) => vendaController.calcular(req, res)
  )

  route.post(
    "/:venda_id/cancelar",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Venda"],
        summary: "Cancela uma venda paga e devolve os itens ao estoque",
        description: `RF05.1/RF05.2 + **RN02/RN03**. ${TENANT_HEADER_DOC} **Caixa (CASHIER) não pode cancelar** — é a única rota de venda restrita por cargo, porque desfaz dinheiro e mexe em estoque. Devolve cada item ao estoque gerando \`MovimentacaoEstoque\` de ENTRADA com motivo \`ESTORNO_VENDA\`, na mesma transação da mudança de status (RN03). Só venda **PAGA** pode ser cancelada: um Pix PENDENTE abandonado nunca baixou estoque, e "devolver" criaria saldo do nada. Cancelar duas vezes é bloqueado com 409, senão o produto voltaria ao estoque em dobro. **Não exige turno aberto** — um gestor precisa poder corrigir erro do dia anterior antes de abrir o caixa.`,
        security: [{ cookieAuth: [] }],
        params: vendaIdParamsSchema,
        response: {
          200: vendaResponseSchema,
          400: errorResponseSchema.describe(
            "ID inválido (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_CANCEL_VENDA)"
          ),
          404: errorResponseSchema.describe(
            "Venda não encontrada nesta loja (code: VENDA_NAO_ENCONTRADA)"
          ),
          409: errorResponseSchema.describe(
            "Venda já cancelada (code: VENDA_JA_CANCELADA) ou nunca paga (code: VENDA_NAO_PAGA)"
          ),
        },
      },
    },
    async (req, res) => vendaController.cancelar(req, res)
  )
}
