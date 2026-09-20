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

/**
 * Status possíveis de uma cobrança no provedor. `PAID` é o único que consolida
 * venda; `APPROVED` aparece em outros fluxos e NÃO significa dinheiro na conta.
 */
export type StatusCobranca =
  | "PENDING"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED"
  | "UNDER_DISPUTE"
  | "REFUNDED"
  | "REDEEMED"
  | "APPROVED"
  | "FAILED"

export interface StatusCobrancaPix {
  payment_id: string
  status: StatusCobranca
  /** Atalho para não espalhar a comparação com "PAID" pelo código. */
  pago: boolean
  expira_em: Date | null
}

export interface IPagamentoGateway {
  /** RF03.1: gera a cobrança Pix e devolve o QR Code. */
  criarCobrancaPix(params: CriarCobrancaPixParams): Promise<CobrancaPixCriada>
  /**
   * Consulta o status da cobrança (polling). É o caminho que o PDV usa
   * enquanto o webhook não está configurado: o cliente está no balcão e o
   * caixa pergunta "já caiu?" a cada poucos segundos.
   *
   * Limite conhecido: se o caixa fechar a tela antes de o cliente pagar,
   * ninguém consulta mais e a venda trava em PENDENTE. Cobrir esse caso é o
   * papel do webhook — os dois se complementam, não são alternativas.
   */
  consultarCobrancaPix(paymentId: string): Promise<StatusCobrancaPix>
  /**
   * SOMENTE DESENVOLVIMENTO: marca uma cobrança como paga sem pagamento real.
   * A própria AbacatePay recusa com chave de produção ("only works with
   * sandbox API keys"), mas não confie só nisso — ver a trava em `routes.ts`.
   */
  simularPagamentoPix(paymentId: string): Promise<StatusCobrancaPix>
  /**
   * RNF02. Recebe o corpo CRU da requisição, não o objeto já parseado: a
   * assinatura é calculada sobre os bytes exatos que o provedor enviou, e
   * reserializar o JSON produz bytes diferentes (ordem de chaves, espaços),
   * o que faria a verificação falhar sempre.
   */
  verificarAssinaturaWebhook(corpoCru: Buffer, assinatura: string | undefined): boolean
}
