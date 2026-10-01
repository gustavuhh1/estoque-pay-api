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
  total_venda: number
  itens: ItemParaGravar[]
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
   */
  cancelar(params: CancelarVendaParams): Promise<VendaComItens>
}
