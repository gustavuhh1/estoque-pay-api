import { randomUUID } from "node:crypto"
import type {
  Estabelecimento,
  MembroEstabelecimento,
} from "../../../../generated/prisma/client.js"
import type {
  CreateWithOwnerParams,
  CreateWithOwnerResult,
  EstabelecimentoComMembro,
  IEstabelecimentoRepository,
  UpdateEstabelecimentoParams,
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

  async findManyByUserId(userId: string): Promise<EstabelecimentoComMembro[]> {
    return this.membros
      .filter((membro) => membro.userId === userId)
      .map((membro) => {
        const estabelecimento = this.estabelecimentos.find(
          (item) => item.id === membro.estabelecimentoId
        )

        if (!estabelecimento) {
          throw new Error(
            `Estabelecimento ${membro.estabelecimentoId} não encontrado no fake de teste.`
          )
        }

        return { estabelecimento, role: membro.role }
      })
  }

  async findById(id: string): Promise<Estabelecimento | null> {
    return this.estabelecimentos.find((item) => item.id === id) ?? null
  }

  async update(
    id: string,
    data: UpdateEstabelecimentoParams
  ): Promise<Estabelecimento> {
    const estabelecimento = this.estabelecimentos.find((item) => item.id === id)

    if (!estabelecimento) {
      throw new Error(`Estabelecimento ${id} não encontrado no fake de teste.`)
    }

    Object.assign(estabelecimento, data)

    return estabelecimento
  }
}
