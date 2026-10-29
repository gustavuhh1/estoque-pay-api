import z from "zod"
import { LIMITES_DO_PLANO, PRECO_PREMIUM, TRIAL_DIAS } from "../planos"
import type { PlanoDaLoja, UsoDaLoja } from "../service/PlanoService"

const limitesSchema = z.object({
  /** null = sem teto. */
  produtos_ativos: z.number().nullable(),
  membros: z.number().nullable(),
  crm_completo: z.boolean(),
  nfce: z.boolean(),
})

export const planosResponseSchema = z.object({
  planos: z.array(
    z.object({
      id: z.enum(["FREE", "PREMIUM"]),
      nome: z.string(),
      /** Free: null. Premium: mensal e anual, só no cartão (D2). */
      precos: z.object({ MENSAL: z.number(), ANUAL: z.number() }).nullable(),
      trial_dias: z.number().nullable(),
      limites: limitesSchema,
    })
  ),
})

/** RF01.1: o catálogo é constante, não lê banco. */
export function montarPlanosResponse() {
  return {
    planos: [
      {
        id: "FREE" as const,
        nome: "Free",
        precos: null,
        trial_dias: null,
        limites: LIMITES_DO_PLANO.FREE,
      },
      {
        id: "PREMIUM" as const,
        nome: "Premium",
        precos: { MENSAL: PRECO_PREMIUM.MENSAL, ANUAL: PRECO_PREMIUM.ANUAL },
        trial_dias: TRIAL_DIAS,
        limites: LIMITES_DO_PLANO.PREMIUM,
      },
    ],
  }
}

export const assinaturaResponseSchema = z.object({
  /** O plano EFETIVO (RN00): derivado do status, não uma coluna. */
  plano: z.enum(["FREE", "PREMIUM"]),
  /** null = a loja nunca assinou. */
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]).nullable(),
  tipo_plano: z.enum(["MENSAL", "ANUAL"]).nullable(),
  trial_expira_em: z.date().nullable(),
  periodo_atual_fim: z.date().nullable(),
  limites: limitesSchema,
  /** O quanto da cota a loja já usa (produtos ativos e membros + convites). */
  uso: z.object({ produtos_ativos: z.number(), membros: z.number() }),
  /**
   * RN03: loja que já teve assinatura (PAST_DUE/CANCELED), voltou ao Free e
   * está na cota ou acima dela. Não perde acesso, mas não cadastra novos
   * produtos nem membros.
   */
  modo_restrito: z.boolean(),
})

export function toAssinaturaResponse(plano: PlanoDaLoja, uso: UsoDaLoja) {
  const { limites } = plano
  const naCota =
    (limites.produtos_ativos !== null && uso.produtos_ativos >= limites.produtos_ativos) ||
    (limites.membros !== null && uso.membros >= limites.membros)

  return {
    ...plano,
    uso,
    // Só faz sentido falar em "restrito" para quem JÁ teve assinatura e a
    // perdeu. Loja que nunca assinou é simplesmente Free.
    modo_restrito: plano.plano === "FREE" && plano.status !== null && naCota,
  }
}
