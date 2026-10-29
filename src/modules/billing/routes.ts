import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { BillingController } from "./controller/BillingController"
import { PlanoService } from "./service/PlanoService"
import { PlanoPrismaRepository } from "./repository/PlanoPrismaRepository"
import { criarAssinaturaService } from "./service/criarAssinaturaService"
import { AbacatePayAssinaturaGateway } from "./gateway/AbacatePayAssinaturaGateway"
import type { IAssinaturaGateway } from "./gateway/IAssinaturaGateway"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  assinaturaIniciadaResponseSchema,
  assinaturaResponseSchema,
  iniciarAssinaturaSchema,
  planosResponseSchema,
} from "./dto/billing.dto"

const TENANT_HEADER_DOC = "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

/**
 * `gateway` é injetável para os testes passarem o InMemoryAssinaturaGateway, sem
 * chave de API e sem rede (mesmo desenho de `pagamentoRoutes`).
 */
export function billingRoutes(gateway: IAssinaturaGateway = new AbacatePayAssinaturaGateway()) {
  return async function (app: FastifyInstance) {
    const planoService = new PlanoService(new PlanoPrismaRepository(prisma))
    const billingController = new BillingController(planoService, criarAssinaturaService(gateway))

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

    route.post(
      "/assinatura",
      {
        preHandler: [requireAuth, requireTenant],
        schema: {
          tags: ["Billing"],
          summary: "Inicia o trial Premium: cria o checkout de assinatura (só cartão)",
          description: `RF01.2 + RN04 + D2 (#65). ${TENANT_HEADER_DOC} **Só o Owner** contrata (403 \`ROLE_CANNOT_MANAGE_PLANO\`). Devolve o \`checkout_url\`: **redirecione o usuário para ele**. É a página da AbacatePay onde o cartão é informado e tokenizado; o cartão nunca passa pela API (RNF02). O trial de 7 dias é gratuito (R$ 0,00 agora) e o primeiro débito acontece só no fim dele. **Esta rota NÃO ativa nada**: a \`Assinatura\` só passa a existir (e a loja a ser Premium) quando a AbacatePay confirma o cartão por webhook (RN04), então sem cartão válido a loja continua Free. Só cartão: pedir \`PIX\` em \`metodo_pagamento\` devolve 400. O trial é um só por loja: com qualquer assinatura já registrada, 409 \`ASSINATURA_JA_EXISTENTE\`.`,
          security: [{ cookieAuth: [] }],
          body: iniciarAssinaturaSchema,
          response: {
            201: assinaturaIniciadaResponseSchema,
            400: errorResponseSchema.describe(
              "Dados inválidos, inclusive Pix (code: VALIDATION_ERROR), header de tenant ausente ou recusa do provedor (code: GATEWAY_ASSINATURA_ERRO)"
            ),
            401: errorResponseSchema.describe("Sessão ausente ou inválida"),
            403: errorResponseSchema.describe(
              "Sem vínculo com esta loja ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PLANO)"
            ),
            409: errorResponseSchema.describe(
              "A loja já tem assinatura (code: ASSINATURA_JA_EXISTENTE)"
            ),
          },
        },
      },
      async (req, res) => billingController.iniciar(req, res)
    )

    route.post(
      "/assinatura/cancelar",
      {
        preHandler: [requireAuth, requireTenant],
        schema: {
          tags: ["Billing"],
          summary: "Cancela a assinatura Premium",
          description: `#66 + RN03. ${TENANT_HEADER_DOC} **Só o Owner**. Cancela **na hora**, sem carência e sem cobranças futuras (a AbacatePay não tem período de graça; cancelar durante o trial funciona igual). A loja não perde o acesso ao painel: volta aos limites do Free (modo restrito se estiver acima da cota) e a **NFC-e é desligada**. Devolve o mesmo corpo de \`GET /billing/assinatura\`.`,
          security: [{ cookieAuth: [] }],
          response: {
            200: assinaturaResponseSchema,
            400: errorResponseSchema.describe(
              "Header ausente ou recusa do provedor (code: GATEWAY_ASSINATURA_ERRO)"
            ),
            401: errorResponseSchema.describe("Sessão ausente ou inválida"),
            403: errorResponseSchema.describe(
              "Sem vínculo com esta loja ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PLANO)"
            ),
            404: errorResponseSchema.describe(
              "A loja não tem assinatura (code: ASSINATURA_NAO_ENCONTRADA)"
            ),
            409: errorResponseSchema.describe(
              "Já cancelada (code: ASSINATURA_JA_CANCELADA)"
            ),
          },
        },
      },
      async (req, res) => billingController.cancelar(req, res)
    )
  }
}
