import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type { IPlanoRepository } from "./IPlanoRepository"

export class PlanoPrismaRepository implements IPlanoRepository {
  constructor(private prisma: PrismaClient) {}

  async findAssinaturaByEstabelecimento(estabelecimentoId: string) {
    return this.prisma.assinatura.findUnique({
      where: { estabelecimento_id: estabelecimentoId },
    })
  }

  async contarProdutosAtivos(estabelecimentoId: string) {
    return this.prisma.produto.count({
      where: { estabelecimento_id: estabelecimentoId, ativo: true, deletado_em: null },
    })
  }

  async contarMembrosEConvites(estabelecimentoId: string) {
    const [membros, convites] = await Promise.all([
      this.prisma.membroEstabelecimento.count({ where: { estabelecimentoId } }),
      this.prisma.conviteFuncionario.count({
        where: { estabelecimentoId, aceitoEm: null },
      }),
    ])

    return membros + convites
  }
}
