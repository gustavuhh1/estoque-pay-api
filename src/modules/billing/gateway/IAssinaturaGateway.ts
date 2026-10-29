import type { TipoPlano } from "../../../../generated/prisma/client.js"

/**
 * Contrato com o provedor de assinatura (issues #65, #66 e #67).
 *
 * O Service depende desta interface, nunca da AbacatePay direto: é isso que
 * permite os testes rodarem com o InMemoryAssinaturaGateway, sem chave de API e
 * sem rede. Mesmo desenho de `IPagamentoGateway`.
 */

export interface ClienteAssinatura {
  email: string
  nome?: string | undefined
  /** CPF ou CNPJ, só dígitos. */
  documento?: string | undefined
}

export interface CriarCheckoutAssinaturaParams {
  estabelecimento_id: string
  tipo_plano: TipoPlano
  cliente: ClienteAssinatura
  /** Botão "Voltar" do checkout. */
  url_retorno: string
  /** Para onde o provedor devolve o cliente depois de pagar. */
  url_conclusao: string
}

export interface CheckoutAssinaturaCriado {
  /** `bill_...` */
  checkout_id: string
  /**
   * Página do provedor onde o cliente informa o cartão. O cartão NUNCA passa
   * pelo nosso backend (RNF02): quem coleta e tokeniza é a AbacatePay.
   */
  url: string
  customer_id: string
}

export type StatusAssinaturaProvedor = "PENDING" | "ACTIVE" | "CANCELLED"

/** Recorte da assinatura (`subs_...`) que o domínio usa. */
export interface AssinaturaDoProvedor {
  subscription_id: string
  customer_id: string
  status: StatusAssinaturaProvedor
  /**
   * Fim do trial. null = sem trial. A primeira cobrança integral é neste
   * instante.
   */
  trial_expira_em: Date | null
  /** Loja dona da assinatura, devolvida do `externalId` do checkout. */
  estabelecimento_id: string | null
  tipo_plano: TipoPlano | null
}

export interface IAssinaturaGateway {
  /**
   * #65 + RN04: cria o checkout de assinatura Premium com trial, só no cartão
   * (D2). A assinatura propriamente dita só passa a existir depois que o
   * cliente informa um cartão válido — quem avisa é o webhook.
   */
  criarCheckoutAssinatura(
    params: CriarCheckoutAssinaturaParams
  ): Promise<CheckoutAssinaturaCriado>
  /**
   * Estado atual da assinatura no provedor. Aceita o id da assinatura
   * (`subs_...`) OU o do checkout (`bill_...`): o payload dos webhooks não é
   * documentado, e os dois levam à mesma assinatura. null = não encontrada.
   */
  consultarAssinatura(id: string): Promise<AssinaturaDoProvedor | null>
  /** Cancela na hora, sem cobranças futuras (o provedor não tem carência). */
  cancelarAssinatura(subscriptionId: string): Promise<void>
}
