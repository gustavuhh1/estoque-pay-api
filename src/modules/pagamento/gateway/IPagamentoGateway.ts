/**
 * Contrato com o provedor de pagamento Pix (issue #52).
 *
 * O Service depende desta interface, nunca do AbacatePay direto: é isso que
 * permite os testes rodarem com o InMemoryPagamentoGateway, sem chave de API e
 * sem rede. Mesmo motivo de `IProdutoRepository` existir em vez do Prisma nu.
 */

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface ClienteCobranca {
  nome?: string | undefined
  email?: string | undefined
  documento?: string | undefined
  telefone?: string | undefined
}

export interface CriarCobrancaPixParams {
  /** Valor total em REAIS. Quem converte para centavos é o gateway. */
  valor: number
  descricao: string
  /** Segundos até o QR Code expirar. */
  expira_em_segundos: number
  /**
   * Vai no `metadata` da cobrança. É o elo da venda com a cobrança no lado do
   * provedor — útil para conciliação manual no painel deles. A correlação que
   * o webhook usa é o `payment_id`, gravado em `Venda.abacatepay_payment_id`.
   */
  venda_id: string
  cliente?: ClienteCobranca | undefined
}

export interface CobrancaPixCriada {
  /** `data.id` do provedor. Vai para `Venda.abacatepay_payment_id` (@unique). */
  payment_id: string
  /** `brCode`: o Pix copia e cola. */
  qr_code: string
  /** `brCodeBase64`: data URI da imagem do QR Code. */
  qr_code_imagem: string
  expira_em: Date
  /** Taxa retida pela plataforma, em reais. Null quando o provedor não informa. */
  taxa_plataforma: number | null
}

export interface IPagamentoGateway {
  /** RF03.1: gera a cobrança Pix e devolve o QR Code. */
  criarCobrancaPix(params: CriarCobrancaPixParams): Promise<CobrancaPixCriada>
  /**
   * RNF02. Recebe o corpo CRU da requisição, não o objeto já parseado: a
   * assinatura é calculada sobre os bytes exatos que o provedor enviou, e
   * reserializar o JSON produz bytes diferentes (ordem de chaves, espaços),
   * o que faria a verificação falhar sempre.
   */
  verificarAssinaturaWebhook(corpoCru: Buffer, assinatura: string | undefined): boolean
}
