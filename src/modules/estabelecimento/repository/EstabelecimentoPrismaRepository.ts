import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  CreateWithOwnerParams,
  CreateWithOwnerResult,
  EstabelecimentoComMembro,
  IEstabelecimentoRepository,
  UpdateEstabelecimentoParams
} from "./IEstabelecimentoRepository"

export class EstabelecimentoPrismaRepository implements IEstabelecimentoRepository {
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
          ie: data.ie ?? null
          // emite_nfce fica de fora: nasce false pelo default do schema. Ver
          // o comentário em CreateWithOwnerParams.
        }
      })

      const membro = await tx.membroEstabelecimento.create({
        data: {
          userId: ownerId,
          estabelecimentoId: estabelecimento.id,
          // RF02.2: o criador da loja é sempre o dono. O default da coluna é
          // CASHIER, então o papel precisa ser explícito aqui.
          role: "OWNER"
        }
      })

      return { estabelecimento, membro }
    })
  }

  async findManyByUserId(userId: string): Promise<EstabelecimentoComMembro[]> {
    const membros = await this.prisma.membroEstabelecimento.findMany({
      where: { userId },
      include: { estabelecimento: true }
    })

    return membros.map((membro) => ({
      estabelecimento: membro.estabelecimento,
      role: membro.role
    }))
  }

  async findById(id: string) {
    return this.prisma.estabelecimento.findUnique({ where: { id } })
  }

  async update(id: string, data: UpdateEstabelecimentoParams) {
    // Sem $transaction: é update de uma tabela só, ao contrário do
    // createWithOwner (que precisa do id gerado para o segundo insert).
    //
    // Monta o objeto campo a campo (em vez de espalhar `data` direto) porque
    // o exactOptionalPropertyTypes do tsconfig deixa UpdateEstabelecimentoParams
    // aceitar `campo: undefined` explícito (pra bater com o DTO do Zod), mas o
    // input de update do Prisma não aceita — só "presente com valor" ou
    // "ausente". O `!== undefined` filtra exatamente isso: campo omitido não
    // vira chave nenhuma, `null` explícito ainda passa (limpa o campo).
    return this.prisma.estabelecimento.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.cnpj !== undefined && { cnpj: data.cnpj }),
        ...(data.ie !== undefined && { ie: data.ie }),
        ...(data.certificado_a1 !== undefined && {
          certificado_a1: data.certificado_a1
        }),
        ...(data.certificado_a1_senha !== undefined && {
          certificado_a1_senha: data.certificado_a1_senha
        })
      }
    })
  }
}
