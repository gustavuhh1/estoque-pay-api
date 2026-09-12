import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  CreateWithOwnerParams,
  CreateWithOwnerResult,
  IEstabelecimentoRepository,
} from "./IEstabelecimentoRepository"

export class EstabelecimentoPrismaRepository
  implements IEstabelecimentoRepository
{
  constructor(private prisma: PrismaClient) {}

  async findByCnpj(cnpj: string) {
    return this.prisma.estabelecimento.findUnique({ where: { cnpj } })
  }

  async createWithOwner({
    ownerId,
    ...data
  }: CreateWithOwnerParams): Promise<CreateWithOwnerResult> {
    // $transaction interativa (callback), não a forma em array: o insert do
    // membro depende do id gerado para o estabelecimento.
    return this.prisma.$transaction(async (tx) => {
      const estabelecimento = await tx.estabelecimento.create({
        data: {
          nome: data.nome,
          cnpj: data.cnpj,
          ie: data.ie ?? null,
          emite_nfce: data.emite_nfce,
        },
      })

      const membro = await tx.membroEstabelecimento.create({
        data: {
          userId: ownerId,
          estabelecimentoId: estabelecimento.id,
          // RF02.2: o criador da loja é sempre o dono. O default da coluna é
          // CASHIER, então o papel precisa ser explícito aqui.
          role: "OWNER",
        },
      })

      return { estabelecimento, membro }
    })
  }
}
