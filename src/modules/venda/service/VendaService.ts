import { Prisma, type Produto, type Role } from "../../../../generated/prisma/client.js"
import {
  ForbiddenError,
  NotFoundError,
  VendaJaCanceladaError,
  VendaNaoPagaError,
} from "@/shared/errors"
import type { IProdutoRepository } from "@/modules/produto/repository/IProdutoRepository"
import type { ItemCarrinhoDTO, VendaComItens } from "../dto/venda.dto"
import type { IVendaRepository } from "../repository/IVendaRepository"

export interface ItemPrecificado {
  produto_id: string
  produto_nome: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

export interface CarrinhoPrecificado {
  itens: ItemPrecificado[]
  total: number
}

/**
 * RF01.1 a RF01.3 — issue #50.
 *
 * Sem `garantirAcesso`: vender é o trabalho do Caixa. As travas por cargo desta
 * fase ficam no cancelamento (#53), não aqui.
 */
export class VendaService {
  constructor(
    private produtoRepository: IProdutoRepository,
    private vendaRepository: IVendaRepository
  ) {}

  /**
   * RN02 — issue #53. Ao contrário da busca, do cálculo e do pagamento (que o
   * Caixa faz o dia inteiro), CANCELAR é o único ato de venda restrito: desfaz
   * dinheiro e mexe em estoque, então precisa de Owner ou Gestor.
   */
  private garantirAcessoCancelamento(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem cancelar vendas.",
        "ROLE_CANNOT_CANCEL_VENDA"
      )
    }
  }

  /** RF01.1 */
  async buscarProdutos(estabelecimentoId: string, termo: string): Promise<Produto[]> {
    return this.produtoRepository.buscarParaVenda(estabelecimentoId, termo)
  }

  /**
   * RF01.2/RF01.3 + RN01. Precifica o carrinho e NÃO grava nada: nem Venda, nem
   * ItemVenda, nem baixa de estoque. O carrinho vive no cliente até o
   * pagamento, e é o pagamento (#51) que cria a venda.
   *
   * O mesmo método é reusado pelo PagamentoService na hora de fechar a venda —
   * é o que garante que o total cobrado é o mesmo que foi mostrado, calculado
   * pela mesma regra e com preço lido do banco nos dois casos.
   */
  async precificarCarrinho(
    estabelecimentoId: string,
    itens: ItemCarrinhoDTO[]
  ): Promise<CarrinhoPrecificado> {
    const precificados: ItemPrecificado[] = []
    // Decimal, nunca soma de float: 0.1 + 0.2 dá 0.30000000000000004 em JS, e
    // num total de venda isso vira centavo errado no fechamento de caixa.
    let total = new Prisma.Decimal(0)

    for (const item of itens) {
      // findByIdAndEstabelecimento já filtra loja + soft delete. Produto de
      // outra loja é indistinguível de inexistente — de propósito.
      const produto = await this.produtoRepository.findByIdAndEstabelecimento(
        item.produto_id,
        estabelecimentoId
      )

      if (!produto) {
        throw new NotFoundError(
          `Produto ${item.produto_id} não encontrado nesta loja.`,
          "PRODUTO_NAO_ENCONTRADO"
        )
      }

      // Produto inativo está fora de linha: some da busca do PDV e também não
      // pode entrar por id, senão a trava da busca seria contornável.
      if (!produto.ativo) {
        throw new NotFoundError(
          `O produto ${produto.nome} está inativo e não pode ser vendido.`,
          "PRODUTO_INATIVO"
        )
      }

      const quantidade = new Prisma.Decimal(item.quantidade.toString())
      // Preço SEMPRE do banco. Se viesse do cliente, bastaria editar a
      // requisição para comprar por R$ 0,01.
      const precoUnitario = produto.preco_venda
      // Dinheiro tem 2 casas: arredonda o subtotal antes de somar, senão um
      // fracionado (0.333 kg) propagaria dízima para o total.
      const subtotal = quantidade.mul(precoUnitario).toDecimalPlaces(2)

      total = total.add(subtotal)

      precificados.push({
        produto_id: produto.id,
        produto_nome: produto.nome,
        quantidade: Number(quantidade),
        preco_unitario: Number(precoUnitario),
        subtotal: Number(subtotal),
      })
    }

    return { itens: precificados, total: Number(total) }
  }

  /**
   * RF05.1/RF05.2 + RN02/RN03 — issue #53.
   *
   * Cancela uma venda PAGA, devolvendo cada item ao estoque com rastro de
   * auditoria. O cancelamento NÃO exige turno aberto: um gestor precisa poder
   * corrigir um erro do dia anterior antes de abrir o caixa.
   *
   * Consequência a ter em mente: cancelar venda de um turno já fechado faz o
   * valor declarado naquele fechamento deixar de bater com as vendas do turno.
   * Reconciliar isso é assunto de relatório financeiro, fora do escopo aqui.
   */
  async cancelar(
    estabelecimentoId: string,
    usuarioId: string,
    role: Role,
    vendaId: string
  ): Promise<VendaComItens> {
    this.garantirAcessoCancelamento(role)

    const venda = await this.vendaRepository.findByIdAndEstabelecimento(
      vendaId,
      estabelecimentoId
    )

    // Venda de outra loja é indistinguível de inexistente, de propósito.
    if (!venda) {
      throw new NotFoundError("Venda não encontrada nesta loja.", "VENDA_NAO_ENCONTRADA")
    }

    // Sem esta trava, cancelar duas vezes devolveria o produto ao estoque em
    // dobro — mercadoria criada do nada.
    if (venda.status_pagamento === "CANCELADO") {
      throw new VendaJaCanceladaError()
    }

    // Pix PENDENTE que o cliente abandonou nunca baixou estoque; "devolver"
    // criaria saldo inexistente. Abandono de cobrança é outro fluxo.
    if (venda.status_pagamento !== "PAGO") {
      throw new VendaNaoPagaError(venda.status_pagamento)
    }

    return this.vendaRepository.cancelar({
      id: venda.id,
      cancelada_por_id: usuarioId,
      estabelecimento_id: estabelecimentoId,
      itens: venda.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: Number(item.quantidade),
      })),
    })
  }
}
