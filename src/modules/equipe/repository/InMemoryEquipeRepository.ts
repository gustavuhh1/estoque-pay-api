import { randomUUID } from "node:crypto"
import type { Role } from "../../../../generated/prisma/client.js"
import type { FuncionarioComUsuario, IEquipeRepository } from "./IEquipeRepository"

/** Fake para testes de unidade do service, sem banco. */
export class InMemoryEquipeRepository implements IEquipeRepository {
  public membros: FuncionarioComUsuario[] = []
  public sessoesRevogadasDe: string[] = []

  seed(membro: {
    estabelecimentoId: string
    userId: string
    role: Role
    nome?: string | null
    email?: string
  }) {
    const registro: FuncionarioComUsuario = {
      id: randomUUID(),
      userId: membro.userId,
      estabelecimentoId: membro.estabelecimentoId,
      role: membro.role,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { name: membro.nome ?? "Funcionário de Teste", email: membro.email ?? `${membro.userId}@email.com` },
    }
    this.membros.push(registro)
    return registro
  }

  async findManyByEstabelecimento(estabelecimentoId: string) {
    return this.membros.filter((m) => m.estabelecimentoId === estabelecimentoId)
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.membros.find((m) => m.id === id && m.estabelecimentoId === estabelecimentoId) ?? null
  }

  async findByUserAndEstabelecimento(userId: string, estabelecimentoId: string) {
    return (
      this.membros.find((m) => m.userId === userId && m.estabelecimentoId === estabelecimentoId) ?? null
    )
  }

  async create(estabelecimentoId: string, userId: string, role: Role): Promise<FuncionarioComUsuario> {
    if (this.membros.some((m) => m.userId === userId && m.estabelecimentoId === estabelecimentoId)) {
      throw Object.assign(new Error("já vinculado"), { code: "P2002" })
    }

    return this.seed({ estabelecimentoId, userId, role })
  }

  async update(id: string, role: Role): Promise<FuncionarioComUsuario> {
    const membro = this.membros.find((m) => m.id === id)

    if (!membro) {
      throw new Error(`Membro ${id} não encontrado no fake de teste.`)
    }

    membro.role = role

    return membro
  }

  async delete(id: string): Promise<void> {
    this.membros = this.membros.filter((m) => m.id !== id)
  }

  async countByEstabelecimentoAndRole(estabelecimentoId: string, role: Role): Promise<number> {
    return this.membros.filter((m) => m.estabelecimentoId === estabelecimentoId && m.role === role).length
  }

  async revogarSessoes(userId: string): Promise<void> {
    this.sessoesRevogadasDe.push(userId)
  }
}
