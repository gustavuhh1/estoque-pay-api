import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { CaixaController } from "./controller/CaixaController"
import { CaixaService } from "./service/CaixaService"
import { CaixaPrismaRepository } from "./repository/CaixaPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import { abrirTurnoSchema, fecharTurnoSchema, turnoResponseSchema } from "./dto/caixa.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (mesmo padrão dos módulos Produto/Categoria/Estoque).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

/**
 * Nota de RBAC: este é o ÚNICO módulo da Fase 03 sem bloqueio por cargo.
 * Qualquer membro da loja — incluindo CASHIER — abre e fecha o turno.
 */
export async function caixaRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const caixaRepository = new CaixaPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const caixaService = new CaixaService(caixaRepository)

  // 3. Instanciar Controller (Presentation)
  const caixaController = new CaixaController(caixaService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/turno",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Caixa"],
        summary: "Abre o turno de caixa da loja",
        description: `RF06.1. ${TENANT_HEADER_DOC} Registra o fundo de troco, quem abriu e o horário. O turno é por **loja**, não por pessoa: enquanto houver um turno ABERTO, ninguém consegue abrir outro (409). **Qualquer cargo pode abrir**, inclusive Caixa — basta ser membro da loja.`,
        security: [{ cookieAuth: [] }],
        body: abrirTurnoSchema,
        response: {
          201: turnoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
          409: errorResponseSchema.describe(
            "A loja já possui um turno aberto (code: TURNO_JA_ABERTO)"
          ),
        },
      },
    },
    async (req, res) => caixaController.abrir(req, res)
  )

  route.get(
    "/turno/atual",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Caixa"],
        summary: "Consulta o turno de caixa aberto da loja",
        description: `${TENANT_HEADER_DOC} Devolve o turno ABERTO da loja, com quem abriu, o valor de abertura e o horário. Responde 404 quando o caixa está fechado — é assim que o cliente sabe que precisa abrir o caixa antes de vender.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: turnoResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
          404: errorResponseSchema.describe(
            "A loja não possui turno aberto (code: TURNO_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => caixaController.buscarAberto(req, res)
  )

  route.patch(
    "/turno/atual",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Caixa"],
        summary: "Fecha o turno de caixa aberto da loja",
        description: `RF06.2. ${TENANT_HEADER_DOC} Registra o valor contado na gaveta, quem fechou e o horário. **Quem fecha pode ser uma pessoa diferente de quem abriu** — as duas pontas ficam registradas. **Qualquer cargo pode fechar**, inclusive Caixa.`,
        security: [{ cookieAuth: [] }],
        body: fecharTurnoSchema,
        response: {
          200: turnoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo com esta loja (code: TENANT_ACCESS_DENIED)"
          ),
          404: errorResponseSchema.describe(
            "A loja não possui turno aberto (code: TURNO_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => caixaController.fechar(req, res)
  )
}
