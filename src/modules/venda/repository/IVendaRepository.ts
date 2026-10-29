import type { MetodoPagamento } from "../../../../generated/prisma/client.js"
import type { VendaComItens } from "../dto/venda.dto"

export interface ItemParaGravar {
  produto_id: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface RegistrarVendaPagaParams {
  estabelecimento_id: string
  usuario_id: string
  turno_id: string
  cliente_id?: string | undefined
  metodo_pagamento: MetodoPagamento
  /** Já com o desconto do cupom aplicado. */
  total_venda: number
  itens: ItemParaGravar[]
  /**
   * RF02.3 (#58): cupom já validado pelo CupomService. O resgate é gravado na
   * mesma transação da venda — cupom consumido sem venda, ou venda com
   * desconto sem o cupom baixado, nunca ficam no banco.
   */
  cupom_id?: string | undefined
}

/**
 * Venda Pix nasce PENDENTE: a baixa de estoque espera o pagamento (RN01). O
 * `id` vem de fora porque a cobrança no provedor é criada ANTES da venda e
 * leva esse id no metadata — assim uma falha do provedor não deixa venda órfã.
 */
export interface RegistrarVendaPixPendenteParams
  extends Omit<RegistrarVendaPagaParams, "metodo_pagamento"> {
  id: string
  abacatepay_payment_id: string
  /** D1: taxa de serviço do Pix, paga pelo consumidor, somada ao total cobrado. */
  taxa_split: number
}

export interface ConsolidacaoPix {
  venda: VendaComItens
  /**
   * `true` só na chamada que de fato virou a venda para PAGO e baixou o
   * estoque. `false` é o reenvio do webhook (ou o polling depois dele): a venda
   * já estava consolidada e nada foi feito de novo.
   */
  consolidada: boolean
}

export interface CancelarVendaParams {
  id: string
  /** Quem apertou o botão. Vai para `Venda.cancelada_por_id` (RF05.1). */
  cancelada_por_id: string
  estabelecimento_id: string
  itens: Array<{ produto_id: string; quantidade: number }>
}

export interface IVendaRepository {
  /**
   * RNF01 — o coração da issue #51.
   *
   * Grava a Venda como PAGO, os ItemVenda e a baixa de estoque de cada item na
   * MESMA transação. Se a baixa de qualquer item falhar (ex: saldo
   * insuficiente), a venda inteira volta atrás: nem sobra Venda órfã, nem
   * estoque baixado pela metade.
   *
   * A baixa reusa `IEstoqueRepository.registrarMovimentacao(..., tx)`, que
   * passou a aceitar transação externa justamente para isto — assim cada item
   * também gera a linha de auditoria em MovimentacaoEstoque (motivo VENDA),
   * sem duplicar a regra de saldo aqui.
   */
  registrarVendaPaga(params: RegistrarVendaPagaParams): Promise<VendaComItens>
  /**
   * Grava a Venda Pix como PENDENTE com os itens e o resgate do cupom (mesma
   * transação), SEM tocar no estoque. O cupom fica consumido desde já — dois
   * Pix simultâneos não podem usar o mesmo — e volta se a cobrança morrer
   * (`cancelarPixPendente`).
   */
  registrarVendaPixPendente(params: RegistrarVendaPixPendenteParams): Promise<VendaComItens>
  /**
   * Sem filtro de loja, de propósito: o webhook é público e não conhece o
   * tenant. Quem tem tenant (o polling) compara `estabelecimento_id` depois.
   */
  findByPaymentId(paymentId: string): Promise<VendaComItens | null>
  /**
   * Consolida o Pix pago: PENDENTE -> PAGO e baixa de estoque na MESMA
   * transação (RNF01). A virada é um update CONDICIONAL em `PENDENTE`, então
   * dois webhooks simultâneos (ou webhook + polling) disputam a linha e só um
   * baixa o estoque — o outro recebe `consolidada: false`.
   */
  consolidarPagamentoPix(vendaId: string): Promise<ConsolidacaoPix>
  /**
   * Cobrança Pix que morreu sem pagamento (expirada/cancelada): PENDENTE ->
   * CANCELADO e devolve o cupom. Não mexe no estoque, que nunca foi baixado.
   * Devolve `false` se a venda já não estava PENDENTE.
   */
  cancelarPixPendente(vendaId: string): Promise<boolean>
  /** Escopado por loja: venda de outra loja retorna null. */
  findByIdAndEstabelecimento(
    id: string,
    estabelecimentoId: string
  ): Promise<VendaComItens | null>
  /**
   * RF05.1/RF05.2 + RN03 — issue #53. O inverso de `registrarVendaPaga`.
   *
   * Marca a venda como CANCELADO e devolve cada item ao estoque na MESMA
   * transação, gerando `MovimentacaoEstoque` de ENTRADA com motivo
   * ESTORNO_VENDA. O rastro do cancelamento nunca fica sem a devolução, nem a
   * devolução sem o rastro.
   *
   * Se a venda consumiu um cupom (#58), ele volta a ficar disponível na mesma
   * transação: o cliente não chegou a usufruir do desconto.
   */
  cancelar(params: CancelarVendaParams): Promise<VendaComItens>
}
