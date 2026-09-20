import { Prisma } from "../../../../generated/prisma/client.js"
import { TurnoFechadoError, ValorPagoInsuficienteError } from "@/shared/errors"
import type { ICaixaRepository } from "@/modules/caixa/repository/ICaixaRepository"
import type { IVendaRepository } from "@/modules/venda/repository/IVendaRepository"
import type { VendaService } from "@/modules/venda/service/VendaService"
import type { VendaComItens } from "@/modules/venda/dto/venda.dto"
import type { RegistrarPagamentoDTO } from "../dto/pagamento.dto"

export interface PagamentoRegistrado {
  venda: VendaComItens
  valor_pago: number | null
  troco: number | null
}

/**
 * RF02.1/RF02.2 + RNF01 — issue #51.
 *
 * Sem `garantirAcesso`: vender é o trabalho do Caixa. Por isso o fluxo usa o
 * `IVendaRepository`/`IEstoqueRepository` direto e NUNCA o `EstoqueService` —
 * aquele bloqueia CASHIER com 403, e toda venda feita por um caixa falharia.
 */
export class PagamentoService {
  constructor(
    private vendaRepository: IVendaRepository,
    private vendaService: VendaService,
    private caixaRepository: ICaixaRepository
  ) {}

  async registrarPagamentoManual(
    estabelecimentoId: string,
    usuarioId: string,
    data: RegistrarPagamentoDTO
  ): Promise<PagamentoRegistrado> {
    // Venda exige turno aberto. Sem isso, o fechamento de caixa acusaria
    // diferença todo dia sem ninguém saber se foi furo ou venda solta — e aí
    // a issue #54 perderia o sentido.
    const turno = await this.caixaRepository.findAbertoByEstabelecimento(estabelecimentoId)

    if (!turno) {
      throw new TurnoFechadoError()
    }

    // Reusa a MESMA precificação do POST /venda/calcular: é o que garante que
    // o total cobrado é o que foi mostrado ao cliente, com preço lido do banco
    // nos dois casos. Também valida produto inexistente/inativo.
    const carrinho = await this.vendaService.precificarCarrinho(
      estabelecimentoId,
      data.itens
    )

    const troco = this.calcularTroco(data, carrinho.total)

    // A transação inteira (Venda + itens + baixa de estoque + auditoria) vive
    // no repositório. Se a baixa de qualquer item estourar o saldo, nada disso
    // fica gravado — RNF01.
    const venda = await this.vendaRepository.registrarVendaPaga({
      estabelecimento_id: estabelecimentoId,
      usuario_id: usuarioId,
      turno_id: turno.id,
      cliente_id: data.cliente_id,
      metodo_pagamento: data.metodo_pagamento,
      total_venda: carrinho.total,
      itens: carrinho.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        subtotal: item.subtotal,
      })),
    })

    return {
      venda,
      valor_pago: data.valor_pago ?? null,
      troco,
    }
  }

  /**
   * Troco só existe em dinheiro. Em cartão o valor é exato por definição.
   * Aritmética com Decimal: `50 - 49.9` dá 0.09999999999999432 em float, e o
   * caixa devolveria troco errado.
   */
  private calcularTroco(data: RegistrarPagamentoDTO, total: number): number | null {
    if (data.metodo_pagamento !== "DINHEIRO" || data.valor_pago === undefined) {
      return null
    }

    const pago = new Prisma.Decimal(data.valor_pago.toString())
    const totalDecimal = new Prisma.Decimal(total.toString())

    if (pago.lessThan(totalDecimal)) {
      throw new ValorPagoInsuficienteError(total, data.valor_pago)
    }

    return Number(pago.sub(totalDecimal).toDecimalPlaces(2))
  }
}
