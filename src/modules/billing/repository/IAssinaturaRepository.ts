import type {
  Assinatura,
  StatusAssinatura,
  TipoPlano,
} from "../../../../generated/prisma/client.js"

export interface SalvarAssinaturaParams {
  estabelecimento_id: string
  abacatepay_sub_id: string
  abacatepay_customer_id: string
  status: StatusAssinatura
  tipo_plano: TipoPlano
  trial_expira_em: Date | null
  periodo_atual_fim: Date | null
  /**
   * RN03: assinatura que deixa de valer (inadimplente ou cancelada) desliga a
   * NFC-e da loja NA MESMA transação. Sem isso, um crash entre as duas
   * escritas deixaria a loja rebaixada ainda emitindo nota.
   */
  desligar_nfce: boolean
}

/**
 * Escrita de `Assinatura`. A leitura (plano efetivo, uso) fica no
 * `IPlanoRepository`.
 */
export interface IAssinaturaRepository {
  /** Cria ou atualiza a assinatura da loja (é única por loja). */
  salvar(params: SalvarAssinaturaParams): Promise<Assinatura>
}
