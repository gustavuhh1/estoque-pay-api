import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  CreateProdutoParams,
  IProdutoRepository,
  UpdateProdutoParams,
} from "./IProdutoRepository"

export class ProdutoPrismaRepository implements IProdutoRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateProdutoParams) {
    return this.prisma.produto.create({
      data: {
        estabelecimento_id: data.estabelecimento_id,
        nome: data.nome,
        ean_gtin: data.ean_gtin ?? null,
        tipo_medida: data.tipo_medida,
        preco_custo: data.preco_custo,
        preco_venda: data.preco_venda,
        quantidade_atual: data.quantidade_atual,
        quantidade_minima: data.quantidade_minima,
        ncm: data.ncm ?? null,
        cfop: data.cfop ?? null,
        ativo: data.ativo,
      },
    })
  }

  async findManyByEstabelecimento(estabelecimentoId: string) {
    return this.prisma.produto.findMany({
      where: { estabelecimento_id: estabelecimentoId, deletado_em: null },
    })
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.produto.findFirst({
      where: { id, estabelecimento_id: estabelecimentoId, deletado_em: null },
    })
  }

  async update(id: string, data: UpdateProdutoParams) {
    // Mesmo padrão de spread condicional do EstabelecimentoPrismaRepository:
    // o exactOptionalPropertyTypes permite `campo: undefined` explícito no
    // params (pra bater com o DTO do Zod), mas o input de update do Prisma
    // não aceita — só presente-com-valor ou ausente.
    return this.prisma.produto.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.ean_gtin !== undefined && { ean_gtin: data.ean_gtin }),
        ...(data.tipo_medida !== undefined && { tipo_medida: data.tipo_medida }),
        ...(data.preco_custo !== undefined && { preco_custo: data.preco_custo }),
        ...(data.preco_venda !== undefined && { preco_venda: data.preco_venda }),
        ...(data.quantidade_atual !== undefined && {
          quantidade_atual: data.quantidade_atual,
        }),
        ...(data.quantidade_minima !== undefined && {
          quantidade_minima: data.quantidade_minima,
        }),
        ...(data.ncm !== undefined && { ncm: data.ncm }),
        ...(data.cfop !== undefined && { cfop: data.cfop }),
        ...(data.ativo !== undefined && { ativo: data.ativo }),
      },
    })
  }

  async existsEanGtin(estabelecimentoId: string, eanGtin: string, excludeId?: string) {
    const produto = await this.prisma.produto.findFirst({
      where: {
        estabelecimento_id: estabelecimentoId,
        ean_gtin: eanGtin,
        deletado_em: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    })

    return produto !== null
  }

  async possuiItensDeVenda(id: string) {
    const total = await this.prisma.itemVenda.count({ where: { produto_id: id } })

    return total > 0
  }

  async hardDelete(id: string): Promise<void> {
    // RF04.4: exclusão permanente. Só é chamado quando o produto nunca foi
    // vendido — apaga primeiro o histórico de estoque (senão a FK RESTRICT em
    // MovimentacaoEstoque.produto_id bloqueia o delete do Produto).
    await this.prisma.$transaction([
      this.prisma.movimentacaoEstoque.deleteMany({ where: { produto_id: id } }),
      this.prisma.produto.delete({ where: { id } }),
    ])
  }

  async softDelete(id: string): Promise<void> {
    // Produto já vendido: "excluir" não pode ser um delete de verdade (FK
    // RESTRICT em ItemVenda.produto_id preservaria o histórico de venda de
    // qualquer forma). Marca como deletado e libera o ean_gtin pra reuso.
    await this.prisma.produto.update({
      where: { id },
      data: { deletado_em: new Date(), ean_gtin: null },
    })
  }
}
