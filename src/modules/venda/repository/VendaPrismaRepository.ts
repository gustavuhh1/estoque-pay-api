import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { IEstoqueRepository } from "@/modules/estoque/repository/IEstoqueRepository"
import type {
  CancelarVendaParams,
  IVendaRepository,
  RegistrarVendaPagaParams,
} from "./IVendaRepository"

const RELACOES_DA_VENDA = {
  itens: { include: { produto: { select: { nome: true } } } },
} as const

export class VendaPrismaRepository implements IVendaRepository {
  /**
   * Recebe o repositório de Estoque para a baixa rodar DENTRO da transação da
   * venda. Mesmo precedente do EstoquePrismaRepository, que já escreve em
   * `produto` (tabela de outro módulo) dentro da transação que ele mesmo abre:
   * quem possui a transação é quem coordena as escritas dela.
   */
  constructor(
    private prisma: PrismaClient,
    private estoqueRepository: IEstoqueRepository
  ) {}

  async registrarVendaPaga(params: RegistrarVendaPagaParams) {
    return this.prisma.$transaction(async (tx) => {
      const venda = await tx.venda.create({
        data: {
          estabelecimento_id: params.estabelecimento_id,
          usuario_id: params.usuario_id,
          turno_id: params.turno_id,
          cliente_id: params.cliente_id ?? null,
          metodo_pagamento: params.metodo_pagamento,
          // Dinheiro e cartão são confirmação manual do caixa: nascem PAGO,
          // sem passar por PENDENTE. Só o Pix espera confirmação externa.
          status_pagamento: "PAGO",
          pago_em: new Date(),
          total_venda: new Prisma.Decimal(params.total_venda.toString()),
          itens: {
            create: params.itens.map((item) => ({
              produto_id: item.produto_id,
              quantidade: new Prisma.Decimal(item.quantidade.toString()),
              preco_unitario: new Prisma.Decimal(item.preco_unitario.toString()),
              subtotal: new Prisma.Decimal(item.subtotal.toString()),
            })),
          },
        },
        include: RELACOES_DA_VENDA,
      })

      // Sequencial de propósito, não Promise.all: cada baixa pega row lock no
      // produto, e disparar em paralelo dentro da mesma transação interativa
      // do Prisma não traz ganho e atrapalha a leitura do erro quando um item
      // estoura o saldo.
      for (const item of params.itens) {
        // Lança EstoqueInsuficienteError se zerar abaixo de zero, derrubando
        // esta transação inteira — a Venda e os itens acima voltam atrás
        // junto. É a RNF01.
        await this.estoqueRepository.registrarMovimentacao(
          {
            estabelecimento_id: params.estabelecimento_id,
            produto_id: item.produto_id,
            usuario_id: params.usuario_id,
            quantidade: item.quantidade,
            tipo: "SAIDA",
            motivo: "VENDA",
            observacao: `Venda ${venda.id}`,
          },
          tx
        )
      }

      return venda
    })
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.venda.findFirst({
      where: { id, estabelecimento_id: estabelecimentoId },
      include: RELACOES_DA_VENDA,
    })
  }

  async cancelar(params: CancelarVendaParams) {
    return this.prisma.$transaction(async (tx) => {
      const venda = await tx.venda.update({
        where: { id: params.id },
        data: {
          status_pagamento: "CANCELADO",
          cancelada_em: new Date(),
          cancelada_por_id: params.cancelada_por_id,
        },
        include: RELACOES_DA_VENDA,
      })

      // RN03: devolve cada item ao estoque com rastro. É o espelho exato da
      // baixa feita na venda — ENTRADA no lugar de SAIDA, ESTORNO_VENDA no
      // lugar de VENDA. O histórico fica com as duas pontas, em vez de a
      // primeira movimentação sumir como se a venda nunca tivesse existido.
      for (const item of params.itens) {
        await this.estoqueRepository.registrarMovimentacao(
          {
            estabelecimento_id: params.estabelecimento_id,
            produto_id: item.produto_id,
            usuario_id: params.cancelada_por_id,
            quantidade: item.quantidade,
            tipo: "ENTRADA",
            motivo: "ESTORNO_VENDA",
            observacao: `Cancelamento da venda ${params.id}`,
          },
          tx
        )
      }

      return venda
    })
  }
}
