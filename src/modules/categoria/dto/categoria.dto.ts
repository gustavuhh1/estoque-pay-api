import z from "zod"
import type { Categoria, Produto } from "../../../../generated/prisma/client.js"

export const createCategoriaSchema = z.object({
  nome: z.string().trim().min(2, "O nome da categoria é obrigatório."),
  // RF11.5: já vincula produtos existentes da loja no momento da criação.
  produto_ids: z.array(z.uuid()).optional(),
})
export type CreateCategoriaDTO = z.infer<typeof createCategoriaSchema>

/** RF09.3: só o nome — o vínculo com produtos tem rotas próprias (ver abaixo). */
export const updateCategoriaSchema = z.object({
  nome: z.string().trim().min(2, "O nome da categoria é obrigatório."),
})
export type UpdateCategoriaDTO = z.infer<typeof updateCategoriaSchema>

export const categoriaParamsSchema = z.object({
  id: z.uuid(),
})
export type CategoriaParams = z.infer<typeof categoriaParamsSchema>

/**
 * RF11.5: corpo das rotas incrementais de vínculo (`POST`/`DELETE
 * .../:id/produtos`). Ao contrário do antigo `produto_ids` do PATCH (que
 * fazia `set` — substituía o conjunto inteiro), aqui cada chamada só
 * adiciona (`connect`) ou remove (`disconnect`) os ids informados, sem
 * afetar o resto do vínculo já existente. Evita que duas edições
 * concorrentes na mesma categoria se sobrescrevam (last-write-wins) e não
 * exige que o cliente conheça a lista completa atual só para mudar um item.
 */
export const produtoIdsSchema = z.object({
  produto_ids: z.array(z.uuid()).min(1, "Informe ao menos um produto."),
})
export type ProdutoIdsDTO = z.infer<typeof produtoIdsSchema>

const produtoResumoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
})

export const categoriaResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  nome: z.string(),
  criado_em: z.date(),
  atualizado_em: z.date(),
  produtos: z.array(produtoResumoSchema),
})
export const listCategoriasResponseSchema = z.array(categoriaResponseSchema)

export type CategoriaComProdutos = Categoria & { produtos: Produto[] }

/** Achata `produtos` para {id, nome} — o catálogo completo não é necessário aqui. */
export function toCategoriaResponse(categoria: CategoriaComProdutos) {
  return {
    ...categoria,
    produtos: categoria.produtos.map((produto) => ({ id: produto.id, nome: produto.nome })),
  }
}
