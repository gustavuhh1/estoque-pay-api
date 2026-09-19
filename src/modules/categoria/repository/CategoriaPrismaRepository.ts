import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  CreateCategoriaParams,
  ICategoriaRepository,
  UpdateCategoriaParams,
} from "./ICategoriaRepository"

export class CategoriaPrismaRepository implements ICategoriaRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateCategoriaParams) {
    return this.prisma.categoria.create({
      data: {
        estabelecimento_id: data.estabelecimento_id,
        nome: data.nome,
        ...(data.produto_ids &&
          data.produto_ids.length > 0 && {
            produtos: { connect: data.produto_ids.map((id) => ({ id })) },
          }),
      },
      include: { produtos: true },
    })
  }

  async findManyByEstabelecimento(estabelecimentoId: string) {
    return this.prisma.categoria.findMany({
      where: { estabelecimento_id: estabelecimentoId },
      include: { produtos: true },
    })
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.categoria.findFirst({
      where: { id, estabelecimento_id: estabelecimentoId },
      include: { produtos: true },
    })
  }

  async update(id: string, data: UpdateCategoriaParams) {
    return this.prisma.categoria.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        // `set` substitui o conjunto inteiro de produtos vinculados.
        ...(data.produto_ids !== undefined && {
          produtos: { set: data.produto_ids.map((id) => ({ id })) },
        }),
      },
      include: { produtos: true },
    })
  }

  async existsNome(estabelecimentoId: string, nome: string, excludeId?: string) {
    const categoria = await this.prisma.categoria.findFirst({
      where: {
        estabelecimento_id: estabelecimentoId,
        nome,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    })

    return categoria !== null
  }

  async delete(id: string): Promise<void> {
    await this.prisma.categoria.delete({ where: { id } })
  }

  async countProdutosByIds(estabelecimentoId: string, produtoIds: string[]) {
    return this.prisma.produto.count({
      where: {
        id: { in: produtoIds },
        estabelecimento_id: estabelecimentoId,
        deletado_em: null,
      },
    })
  }
}
