import { randomUUID } from "node:crypto"
import type { ConviteFuncionario } from "../../../../generated/prisma/client.js"
import type { IConviteRepository, UpsertConviteParams } from "./IConviteRepository"

/** Fake para testes de unidade do service, sem banco. */
export class InMemoryConviteRepository implements IConviteRepository {
  public convites: ConviteFuncionario[] = []

  async upsertPendente(data: UpsertConviteParams): Promise<ConviteFuncionario> {
    const existente = this.convites.find(
      (c) => c.email === data.email && c.estabelecimentoId === data.estabelecimentoId
    )

    if (existente) {
      existente.role = data.role
      existente.criadoPorId = data.criadoPorId
      existente.aceitoEm = null
      return existente
    }

    const convite: ConviteFuncionario = {
      id: randomUUID(),
      email: data.email,
      estabelecimentoId: data.estabelecimentoId,
      role: data.role,
      criadoPorId: data.criadoPorId,
      createdAt: new Date(),
      aceitoEm: null,
    }
    this.convites.push(convite)

    return convite
  }

  async findManyPendentesByEstabelecimento(estabelecimentoId: string) {
    return this.convites.filter((c) => c.estabelecimentoId === estabelecimentoId && c.aceitoEm === null)
  }
}
