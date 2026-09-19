import type { CategoriaComProdutos } from "../dto/categoria.dto"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CreateCategoriaParams {
  estabelecimento_id: string
  nome: string
  produto_ids?: string[] | undefined
}

export interface UpdateCategoriaParams {
  nome: string
}

export interface ICategoriaRepository {
  create(data: CreateCategoriaParams): Promise<CategoriaComProdutos>
  findManyByEstabelecimento(estabelecimentoId: string): Promise<CategoriaComProdutos[]>
  /** Escopado por loja: categoria de outra loja retorna null. */
  findByIdAndEstabelecimento(
    id: string,
    estabelecimentoId: string
  ): Promise<CategoriaComProdutos | null>
  /** RF09.3: atualização do nome. O vínculo N:N tem métodos próprios abaixo. */
  update(id: string, data: UpdateCategoriaParams): Promise<CategoriaComProdutos>
  existsNome(estabelecimentoId: string, nome: string, excludeId?: string): Promise<boolean>
  /**
   * RN02/RN08: exclusão desimpedida — o cascade da FK do join table
   * (`_CategoriaToProduto`) já remove só o vínculo, nunca o Produto.
   */
  delete(id: string): Promise<void>
  /** Conta quantos dos ids informados são produtos de verdade desta loja (valida produto_ids). */
  countProdutosByIds(estabelecimentoId: string, produtoIds: string[]): Promise<number>
  /** RF11.5: incremental (Prisma `connect`) — só adiciona, não afeta o resto do vínculo. */
  addProdutos(id: string, produtoIds: string[]): Promise<CategoriaComProdutos>
  /** RF11.5: incremental (Prisma `disconnect`) — só remove, não afeta o resto do vínculo. */
  removeProdutos(id: string, produtoIds: string[]): Promise<CategoriaComProdutos>
}
