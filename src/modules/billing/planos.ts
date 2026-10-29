import type { PlanoEfetivo } from "@/shared/utils"

/**
 * RN01 (Fase 5) + D2 — catálogo de planos. Fonte única dos números: o
 * `PlanoService`, o endpoint de planos e os testes leem daqui, nenhum módulo
 * copia "50" ou "3" por conta própria.
 *
 * `null` em um limite = sem teto.
 */
export interface LimitesDoPlano {
  /** Produtos com `ativo = true` (soft deletados não contam). */
  produtos_ativos: number | null
  /** Membros da equipe, contando o Owner e os convites pendentes. */
  membros: number | null
  /**
   * Free guarda só CPF e Nome do cliente; Premium libera telefone, data de
   * nascimento e observação.
   */
  crm_completo: boolean
  /** Emissão (simulada, D3) de NFC-e. */
  nfce: boolean
}

export const LIMITES_DO_PLANO: Record<PlanoEfetivo, LimitesDoPlano> = {
  FREE: { produtos_ativos: 50, membros: 3, crm_completo: false, nfce: false },
  PREMIUM: { produtos_ativos: null, membros: null, crm_completo: true, nfce: true },
}

/** D2: R$ 30,00/mês ou R$ 299,90/ano, só no cartão. */
export const PRECO_PREMIUM = { MENSAL: 30, ANUAL: 299.9 } as const

/** D2: trial gratuito de 7 dias, com cartão válido registrado antes (RN04). */
export const TRIAL_DIAS = 7
