import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { CriarNotificacaoParams, INotificacaoRepository } from "./INotificacaoRepository"

export class NotificacaoPrismaRepository implements INotificacaoRepository {
  constructor(private prisma: PrismaClient) {}

  async criar(params: CriarNotificacaoParams) {
    // createMany + skipDuplicates vira `INSERT ... ON CONFLICT DO NOTHING`: a
    // colisão com o índice único PARCIAL (chave não lida) é descartada pelo
    // próprio Postgres, sem exceção e sem corrida entre "conferir" e "gravar".
    const { count } = await this.prisma.notificacao.createMany({
      data: [
        {
          estabelecimento_id: params.estabelecimento_id,
          tipo: params.tipo,
          titulo: params.titulo,
          mensagem: params.mensagem,
          link: params.link ?? null,
          chave: params.chave ?? null,
        },
      ],
      skipDuplicates: true,
    })

    return count > 0
  }

  async listar(estabelecimentoId: string, limite: number) {
    return this.prisma.notificacao.findMany({
      where: { estabelecimento_id: estabelecimentoId },
      // `id` desempata notificações do mesmo instante (venda que gera várias).
      orderBy: [{ criada_em: "desc" }, { id: "desc" }],
      take: limite,
    })
  }

  async contarNaoLidas(estabelecimentoId: string) {
    return this.prisma.notificacao.count({
      where: { estabelecimento_id: estabelecimentoId, lida_em: null },
    })
  }

  async marcarLida(id: string, estabelecimentoId: string) {
    // updateMany com a loja no WHERE: id de outra loja simplesmente não casa.
    // `lida_em: null` mantém a data da PRIMEIRA leitura em cliques repetidos.
    await this.prisma.notificacao.updateMany({
      where: { id, estabelecimento_id: estabelecimentoId, lida_em: null },
      data: { lida_em: new Date() },
    })

    return this.prisma.notificacao.findFirst({
      where: { id, estabelecimento_id: estabelecimentoId },
    })
  }

  async marcarTodasLidas(estabelecimentoId: string) {
    const { count } = await this.prisma.notificacao.updateMany({
      where: { estabelecimento_id: estabelecimentoId, lida_em: null },
      data: { lida_em: new Date() },
    })

    return count
  }

  async buscarProdutos(estabelecimentoId: string, ids: string[]) {
    return this.prisma.produto.findMany({
      where: { estabelecimento_id: estabelecimentoId, id: { in: ids } },
      select: {
        id: true,
        nome: true,
        tipo_medida: true,
        quantidade_atual: true,
        quantidade_minima: true,
        deletado_em: true,
      },
    })
  }

  async somarVendasEmDinheiroDoTurno(turnoId: string) {
    const { _sum } = await this.prisma.venda.aggregate({
      where: { turno_id: turnoId, metodo_pagamento: "DINHEIRO", status_pagamento: "PAGO" },
      _sum: { total_venda: true },
    })

    return _sum.total_venda ?? new Prisma.Decimal(0)
  }
}
