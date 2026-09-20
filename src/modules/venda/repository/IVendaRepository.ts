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
}
