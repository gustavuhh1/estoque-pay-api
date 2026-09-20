import type { Produto, TipoMedida } from "../../../../generated/prisma/client.js"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CreateProdutoParams {
  estabelecimento_id: string
  nome: string
  ean_gtin?: string | undefined
  tipo_medida: TipoMedida
  preco_custo: number
  preco_venda: number
  quantidade_atual: number
  quantidade_minima: number
  ncm?: string | undefined
  cfop?: string | undefined
  ativo: boolean // já calculado pelo Service (RN09.1) antes de chegar aqui
}

export interface UpdateProdutoParams {
  nome?: string | undefined
  ean_gtin?: string | null | undefined
  tipo_medida?: TipoMedida | undefined
  preco_custo?: number | undefined
  preco_venda?: number | undefined
  quantidade_atual?: number | undefined
  quantidade_minima?: number | undefined
  ncm?: string | null | undefined
  cfop?: string | null | undefined
  ativo?: boolean | undefined
}

export interface IProdutoRepository {
  create(data: CreateProdutoParams): Promise<Produto>
  /** RF02.2: só produtos não soft-deletados (deletado_em: null) da loja. */
  findManyByEstabelecimento(estabelecimentoId: string): Promise<Produto[]>
  /**
   * RF01.1 (PDV): busca por código de barras ou nome, para o caixa montar a
   * venda. Semântica DIFERENTE do findManyByEstabelecimento: aqui produto
   * inativo NÃO aparece — a listagem de gestão mostra inativos de propósito,
   * o balcão não pode vender o que está fora de linha.
   *
   * Casamento exato no `ean_gtin` (o leitor devolve o código inteiro) e
   * parcial, sem diferenciar maiúsculas, no `nome`.
   */
  buscarParaVenda(estabelecimentoId: string, termo: string): Promise<Produto[]>
  /** Escopado por loja: produto de outra loja (ou soft-deletado) retorna null. */
  findByIdAndEstabelecimento(id: string, estabelecimentoId: string): Promise<Produto | null>
  /** RF03.3 / RF05.5 / RF06.6: atualização parcial (inclui toggles de `ativo`). */
  update(id: string, data: UpdateProdutoParams): Promise<Produto>
  existsEanGtin(estabelecimentoId: string, eanGtin: string, excludeId?: string): Promise<boolean>
  /** true se existir qualquer ItemVenda referenciando este produto. */
  possuiItensDeVenda(id: string): Promise<boolean>
  /**
   * RF04.4: exclusão permanente. Só é seguro chamar quando `possuiItensDeVenda`
   * é false — apaga o MovimentacaoEstoque do produto e o Produto numa transação.
   */
  hardDelete(id: string): Promise<void>
  /**
   * Soft delete invisível para produtos com histórico de venda: seta
   * `deletado_em` e libera o `ean_gtin` (o produto some de toda listagem de
   * gestão, mas ItemVenda/MovimentacaoEstoque continuam intactos).
   */
  softDelete(id: string): Promise<void>
}
