import { randomUUID } from "node:crypto"
import type {
  Estabelecimento,
  MembroEstabelecimento,
} from "../../../../generated/prisma/client.js"
import type {
  CreateWithOwnerParams,
  CreateWithOwnerResult,
  IEstabelecimentoRepository,
} from "./IEstabelecimentoRepository"

/**
 * Fake para testes de unidade do service, sem banco.
 * `createWithOwner` é atômico por construção: os dois pushes só acontecem
 * depois que nenhuma validação falhou.
 */
export class InMemoryEstabelecimentoRepository
  implements IEstabelecimentoRepository
{
  public estabelecimentos: Estabelecimento[] = []
  public membros: MembroEstabelecimento[] = []

  async findByCnpj(cnpj: string): Promise<Estabelecimento | null> {
    return this.estabelecimentos.find((item) => item.cnpj === cnpj) ?? null
  }

  async createWithOwner({
    ownerId,
    ...data
  }: CreateWithOwnerParams): Promise<CreateWithOwnerResult> {
    const estabelecimento: Estabelecimento = {
      id: randomUUID(),
      nome: data.nome,
      cnpj: data.cnpj,
      ie: data.ie ?? null,
      certificado_a1: null,
      certificado_a1_senha: null,
      emite_nfce: false,
      criado_em: new Date(),
    }

    const membro: MembroEstabelecimento = {
      id: randomUUID(),
      userId: ownerId,
      estabelecimentoId: estabelecimento.id,
      role: "OWNER",
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.estabelecimentos.push(estabelecimento)
    this.membros.push(membro)

    return { estabelecimento, membro }
  }
}
