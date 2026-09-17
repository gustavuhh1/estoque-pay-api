import type { PrismaClient, Role } from "../../../../generated/prisma/client.js"
import type { FuncionarioComUsuario, IEquipeRepository } from "./IEquipeRepository"

const SELECT_COM_USUARIO = {
  include: { user: { select: { name: true, email: true } } },
} as const

export class EquipePrismaRepository implements IEquipeRepository {
  constructor(private prisma: PrismaClient) {}

  async findManyByEstabelecimento(estabelecimentoId: string): Promise<FuncionarioComUsuario[]> {
    return this.prisma.membroEstabelecimento.findMany({
      where: { estabelecimentoId },
      ...SELECT_COM_USUARIO,
    })
  }

  async findByIdAndEstabelecimento(
    id: string,
    estabelecimentoId: string
  ): Promise<FuncionarioComUsuario | null> {
    return this.prisma.membroEstabelecimento.findFirst({
      where: { id, estabelecimentoId },
      ...SELECT_COM_USUARIO,
    })
  }

  async findByUserAndEstabelecimento(userId: string, estabelecimentoId: string) {
    return this.prisma.membroEstabelecimento.findUnique({
      where: { userId_estabelecimentoId: { userId, estabelecimentoId } },
    })
  }

  async create(estabelecimentoId: string, userId: string, role: Role) {
    return this.prisma.membroEstabelecimento.create({
      data: { estabelecimentoId, userId, role },
      ...SELECT_COM_USUARIO,
    })
  }

  async update(id: string, role: Role) {
    return this.prisma.membroEstabelecimento.update({
      where: { id },
      data: { role },
      ...SELECT_COM_USUARIO,
    })
  }

  async delete(id: string): Promise<void> {
    await this.prisma.membroEstabelecimento.delete({ where: { id } })
  }

  async countByEstabelecimentoAndRole(estabelecimentoId: string, role: Role) {
    return this.prisma.membroEstabelecimento.count({ where: { estabelecimentoId, role } })
  }

  async revogarSessoes(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } })
  }
}
