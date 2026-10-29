import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import { CupomJaResgatadoError } from "@/shared/errors"
import type { IEstoqueRepository } from "@/modules/estoque/repository/IEstoqueRepository"
import type {
  CancelarVendaParams,
  ConsolidacaoPix,
  IVendaRepository,
  RegistrarVendaPagaParams,
  RegistrarVendaPixPendenteParams,
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
      const venda = await this.gravarVenda(tx, params, {
        // Dinheiro e cartão são confirmação manual do caixa: nascem PAGO,
        // sem passar por PENDENTE. Só o Pix espera confirmação externa.
        status_pagamento: "PAGO",
        pago_em: new Date(),
      })

      await this.baixarEstoque(
        tx,
        params.estabelecimento_id,
        params.usuario_id,
        venda.id,
        params.itens
      )

      return venda
    })
  }

  async registrarVendaPixPendente(params: RegistrarVendaPixPendenteParams) {
    return this.prisma.$transaction((tx) =>
      this.gravarVenda(
        tx,
        { ...params, metodo_pagamento: "PIX_ABACATEPAY" },
        {
          id: params.id,
          status_pagamento: "PENDENTE",
          pago_em: null,
          abacatepay_payment_id: params.abacatepay_payment_id,
          taxa_split: new Prisma.Decimal(params.taxa_split.toString()),
        }
      )
    )
  }

  async findByPaymentId(paymentId: string) {
    return this.prisma.venda.findUnique({
      where: { abacatepay_payment_id: paymentId },
      include: RELACOES_DA_VENDA,
    })
  }

  async consolidarPagamentoPix(vendaId: string): Promise<ConsolidacaoPix> {
    return this.prisma.$transaction(async (tx) => {
      // Update CONDICIONAL em PENDENTE: o Postgres serializa as escritas na
      // linha, então de dois consolidadores simultâneos só um encontra
      // PENDENTE (count 1) e o outro sai com count 0 sem baixar nada. É isto
      // que impede o estoque de baixar em dobro no reenvio do webhook.
      const virada = await tx.venda.updateMany({
        where: { id: vendaId, status_pagamento: "PENDENTE" },
        data: { status_pagamento: "PAGO", pago_em: new Date() },
      })

      const venda = await tx.venda.findUniqueOrThrow({
        where: { id: vendaId },
        include: RELACOES_DA_VENDA,
      })

      if (virada.count === 0) {
        return { venda, consolidada: false }
      }

      await this.baixarEstoque(
        tx,
        venda.estabelecimento_id,
        venda.usuario_id,
        venda.id,
        venda.itens.map((item) => ({
          produto_id: item.produto_id,
          quantidade: Number(item.quantidade),
        }))
      )

      return { venda, consolidada: true }
    })
  }

  async cancelarPixPendente(vendaId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cancelada = await tx.venda.updateMany({
        where: { id: vendaId, status_pagamento: "PENDENTE" },
        data: { status_pagamento: "CANCELADO", cancelada_em: new Date() },
      })

      if (cancelada.count === 0) {
        return false
      }

      // O cupom foi consumido na criação da venda; sem pagamento, volta.
      await tx.cupom.updateMany({
        where: { venda_id: vendaId },
        data: { resgatado_em: null, venda_id: null },
      })

      return true
    })
  }

  /**
   * Venda + itens + resgate do cupom, na transação de quem chama. Comum à venda
   * manual (já PAGA) e à Pix (PENDENTE) — só muda o que `extras` carrega.
   */
  private async gravarVenda(
    tx: Prisma.TransactionClient,
    params: RegistrarVendaPagaParams,
    extras: Pick<
      Prisma.VendaUncheckedCreateInput,
      "id" | "status_pagamento" | "pago_em" | "abacatepay_payment_id" | "taxa_split"
    >
  ) {
    const venda = await tx.venda.create({
      data: {
        ...extras,
        estabelecimento_id: params.estabelecimento_id,
        usuario_id: params.usuario_id,
        turno_id: params.turno_id,
        cliente_id: params.cliente_id ?? null,
        metodo_pagamento: params.metodo_pagamento,
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

    if (params.cupom_id) {
      // Update CONDICIONAL: só baixa se ainda não foi resgatado. Duas vendas
      // simultâneas com o mesmo cupom passam as duas pela validação prévia
      // do CupomService; aqui o row lock do Postgres serializa as duas e a
      // segunda encontra `resgatado_em` preenchido, atualiza 0 linhas e
      // derruba a própria transação — o desconto não é dado duas vezes.
      const resgate = await tx.cupom.updateMany({
        where: { id: params.cupom_id, resgatado_em: null },
        data: { resgatado_em: new Date(), venda_id: venda.id },
      })

      if (resgate.count === 0) {
        throw new CupomJaResgatadoError()
      }
    }

    return venda
  }

  /**
   * Baixa cada item com auditoria (motivo VENDA), na transação de quem chama.
   *
   * Sequencial de propósito, não Promise.all: cada baixa pega row lock no
   * produto, e disparar em paralelo dentro da mesma transação interativa
   * do Prisma não traz ganho e atrapalha a leitura do erro quando um item
   * estoura o saldo.
   */
  private async baixarEstoque(
    tx: Prisma.TransactionClient,
    estabelecimentoId: string,
    usuarioId: string,
    vendaId: string,
    itens: Array<{ produto_id: string; quantidade: number }>
  ) {
    for (const item of itens) {
      // Lança EstoqueInsuficienteError se zerar abaixo de zero, derrubando
      // esta transação inteira — a Venda e os itens voltam atrás junto. É a
      // RNF01.
      await this.estoqueRepository.registrarMovimentacao(
        {
          estabelecimento_id: estabelecimentoId,
          produto_id: item.produto_id,
          usuario_id: usuarioId,
          quantidade: item.quantidade,
          tipo: "SAIDA",
          motivo: "VENDA",
          observacao: `Venda ${vendaId}`,
        },
        tx
      )
    }
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

      // #58: o cupom consumido nesta venda volta a ficar disponível. Sem
      // isto, cancelar e refazer a venda (ex: item errado) faria o cliente
      // perder o desconto que não chegou a usufruir.
      await tx.cupom.updateMany({
        where: { venda_id: params.id },
        data: { resgatado_em: null, venda_id: null },
      })

      return venda
    })
  }
}
