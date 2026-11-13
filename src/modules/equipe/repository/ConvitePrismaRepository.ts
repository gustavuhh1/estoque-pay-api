import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type { IConviteRepository, UpsertConviteParams } from "./IConviteRepository"

export class ConvitePrismaRepository implements IConviteRepository {
  constructor(private prisma: PrismaClient) {}

  async upsertPendente(data: UpsertConviteParams) {
    return this.prisma.conviteFuncionario.upsert({
      where: { email_estabelecimentoId: { email: data.email, estabelecimentoId: data.estabelecimentoId } },
      create: {
        email: data.email,
        estabelecimentoId: data.estabelecimentoId,
        role: data.role,
        criadoPorId: data.criadoPorId,
      },
      update: {
        role: data.role,
        criadoPorId: data.criadoPorId,
        aceitoEm: null,
      },
    })
  }

  async findManyPendentesByEstabelecimento(estabelecimentoId: string) {
    return this.prisma.conviteFuncionario.findMany({
      where: { estabelecimentoId, aceitoEm: null },
    })
  }

  async findPendenteByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.conviteFuncionario.findFirst({ where: { id, estabelecimentoId, aceitoEm: null } })
  }

  async delete(id: string) {
    // deleteMany: se outra requisição já apagou o convite, não vira 500 (P2025); o pedido de cancelar fica atendido.
    await this.prisma.conviteFuncionario.deleteMany({ where: { id, aceitoEm: null } })
  }
}
