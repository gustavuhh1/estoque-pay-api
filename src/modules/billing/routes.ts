import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { BillingController } from "./controller/BillingController"
import { PlanoService } from "./service/PlanoService"
import { PlanoPrismaRepository } from "./repository/PlanoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import { assinaturaResponseSchema, planosResponseSchema } from "./dto/billing.dto"

const TENANT_HEADER_DOC = "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function billingRoutes(app: FastifyInstance) {
  const planoService = new PlanoService(new PlanoPrismaRepository(prisma))
  const billingController = new BillingController(planoService)

  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    "/planos",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Billing"],
        summary: "Lista os planos e seus limites",
        description:
          "RF01.1 + D2. Catálogo fixo: **Free** (50 produtos ativos, 3 membros contando o Owner, CRM só com CPF e Nome, sem NFC-e) e **Premium** (R$ 30,00/mês ou R$ 299,90/ano, só no cartão, trial de 7 dias, sem os tetos do Free). Exige sessão, mas não loja: dá para mostrar os planos antes de o usuário ter criado uma.",
        security: [{ cookieAuth: [] }],
        response: {
          200: planosResponseSchema,
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
        },
      },
    },
    async (req, res) => billingController.listarPlanos(req, res)
  )

  route.get(
    "/assinatura",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Billing"],
        summary: "Plano efetivo, limites e uso da loja ativa",
        description: `RN00. ${TENANT_HEADER_DOC} O \`plano\` é **derivado** de \`Assinatura.status\` (Premium só em TRIALING/ACTIVE; sem assinatura, PAST_DUE ou CANCELED vale o Free). Devolve também os limites do plano, o uso atual (produtos ativos e membros + convites pendentes) e \`modo_restrito\` (RN03: loja que já teve assinatura, voltou ao Free e está na cota). Qualquer cargo consulta.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: assinaturaResponseSchema,
          400: errorResponseSchema.describe("Header x-estabelecimento-id ausente"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
        },
      },
    },
    async (req, res) => billingController.consultarAssinatura(req, res)
  )
}
