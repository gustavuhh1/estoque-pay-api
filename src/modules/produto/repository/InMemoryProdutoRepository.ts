import { randomUUID } from "node:crypto"
import { Prisma, type Produto } from "../../../../generated/prisma/client.js"
import type {
  CreateProdutoParams,
  IProdutoRepository,
  UpdateProdutoParams,
} from "./IProdutoRepository"

/** Fake para testes de unidade do service, sem banco. */
export class InMemoryProdutoRepository implements IProdutoRepository {
  public produtos: Produto[] = []
  public itensVendaPorProduto = new Set<string>()

  async create(data: CreateProdutoParams): Promise<Produto> {
    const produto: Produto = {
      id: randomUUID(),
      estabelecimento_id: data.estabelecimento_id,
      nome: data.nome,
      ean_gtin: data.ean_gtin ?? null,
      tipo_medida: data.tipo_medida,
      preco_custo: new Prisma.Decimal(data.preco_custo),
      preco_venda: new Prisma.Decimal(data.preco_venda),
      quantidade_atual: new Prisma.Decimal(data.quantidade_atual),
      quantidade_minima: new Prisma.Decimal(data.quantidade_minima),
      ncm: data.ncm ?? null,
      cfop: data.cfop ?? null,
      ativo: data.ativo,
      deletado_em: null,
      criado_em: new Date(),
      atualizado_em: new Date(),
    }

    this.produtos.push(produto)

    return produto
  }

  async findManyByEstabelecimento(estabelecimentoId: string): Promise<Produto[]> {
    return this.produtos.filter(
      (produto) =>
        produto.estabelecimento_id === estabelecimentoId && produto.deletado_em === null
    )
  }

  async findByIdAndEstabelecimento(
    id: string,
    estabelecimentoId: string
  ): Promise<Produto | null> {
    return (
      this.produtos.find(
        (produto) =>
          produto.id === id &&
          produto.estabelecimento_id === estabelecimentoId &&
          produto.deletado_em === null
      ) ?? null
    )
  }

  async update(id: string, data: UpdateProdutoParams): Promise<Produto> {
    const produto = this.produtos.find((item) => item.id === id)

    if (!produto) {
      throw new Error(`Produto ${id} não encontrado no fake de teste.`)
    }

    Object.assign(produto, data)

    return produto
  }

  async existsEanGtin(
    estabelecimentoId: string,
    eanGtin: string,
    excludeId?: string
  ): Promise<boolean> {
    return this.produtos.some(
      (produto) =>
        produto.estabelecimento_id === estabelecimentoId &&
        produto.ean_gtin === eanGtin &&
        produto.deletado_em === null &&
        produto.id !== excludeId
    )
  }

  async possuiItensDeVenda(id: string): Promise<boolean> {
    return this.itensVendaPorProduto.has(id)
  }

  async hardDelete(id: string): Promise<void> {
    this.produtos = this.produtos.filter((produto) => produto.id !== id)
  }

  async softDelete(id: string): Promise<void> {
    const produto = this.produtos.find((item) => item.id === id)

    if (!produto) {
      throw new Error(`Produto ${id} não encontrado no fake de teste.`)
    }

    produto.deletado_em = new Date()
    produto.ean_gtin = null
  }
}
