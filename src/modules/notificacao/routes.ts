import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { NotificacaoController } from "./controller/NotificacaoController"
import { criarNotificacaoService } from "./service/criarNotificacaoService"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  listNotificacoesResponseSchema,
  listarNotificacoesQuerySchema,
  marcarTodasResponseSchema,
  notificacaoIdParamsSchema,
  notificacaoResponseSchema,
} from "./dto/notificacao.dto"

const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

const TIPOS_DOC =
  "Tipos: `ESTOQUE_BAIXO` (produto cruzou o mínimo após venda paga ou saída manual), `ESTOQUE_ZERADO` (produto chegou a zero), `VENDA_CANCELADA`, `PIX_CONFIRMADO` (o provedor confirmou o pagamento) e `CAIXA_DIFERENCA` (turno fechado com valor contado diferente do esperado: fundo + vendas em dinheiro)."

/**
 * Notificações da loja (sininho do painel). Sem trava de cargo: qualquer
 * membro da loja vê e marca como lida — a notificação é da loja, não da pessoa.
 */
export async function notificacaoRoutes(app: FastifyInstance) {
  const notificacaoController = new NotificacaoController(criarNotificacaoService())

  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Notificação"],
        summary: "Lista as notificações da loja",
        description: `${TENANT_HEADER_DOC} Mais recentes primeiro, até \`limite\` itens (padrão 30). \`nao_lidas\` é o total de não lidas da loja, para o badge do sininho. ${TIPOS_DOC} Avisos repetitivos são deduplicados: enquanto houver um "estoque baixo" não lido de um produto, novas vendas dele não criam outro. Qualquer cargo tem acesso.`,
        security: [{ cookieAuth: [] }],
        querystring: listarNotificacoesQuerySchema,
        response: {
          200: listNotificacoesResponseSchema,
          400: errorResponseSchema.describe(
            "Query inválida (code: VALIDATION_ERROR) ou header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
        },
      },
    },
    async (req, res) => notificacaoController.listar(req, res)
  )

  // Declarada antes de "/:id/lida" só por legibilidade: o roteador do Fastify
  // já prioriza o segmento estático "lidas" sobre o parâmetro.
  route.patch(
    "/lidas",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Notificação"],
        summary: "Marca todas as notificações da loja como lidas",
        description: `${TENANT_HEADER_DOC} Idempotente: chamar de novo devolve \`atualizadas: 0\`.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: marcarTodasResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
        },
      },
    },
    async (req, res) => notificacaoController.marcarTodasLidas(req, res)
  )

  route.patch(
    "/:id/lida",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Notificação"],
        summary: "Marca uma notificação como lida",
        description: `${TENANT_HEADER_DOC} Idempotente: marcar de novo mantém a data da primeira leitura. Notificação de outra loja responde 404.`,
        security: [{ cookieAuth: [] }],
        params: notificacaoIdParamsSchema,
        response: {
          200: notificacaoResponseSchema,
          400: errorResponseSchema.describe(
            "Id inválido (code: VALIDATION_ERROR) ou header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
          404: errorResponseSchema.describe(
            "Notificação não encontrada nesta loja (code: NOTIFICACAO_NAO_ENCONTRADA)"
          ),
        },
      },
    },
    async (req, res) => notificacaoController.marcarLida(req, res)
  )
}
