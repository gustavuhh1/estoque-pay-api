import z from "zod"
import type { Categoria, Produto } from "../../../../generated/prisma/client.js"

export const createCategoriaSchema = z.object({
  nome: z.string().trim().min(2, "O nome da categoria é obrigatório."),
  // RF11.5: já vincula produtos existentes da loja no momento da criação.
  produto_ids: z.array(z.uuid()).optional(),
})
export type CreateCategoriaDTO = z.infer<typeof createCategoriaSchema>

/**
 * RF09.3/RF11.5: atualização parcial. `produto_ids`, quando presente,
 * substitui o conjunto inteiro de produtos vinculados (Prisma `set`) — mais
 * simples e previsível de testar do que um incremento (connect-only).
 */
export const updateCategoriaSchema = z
  .object({
    nome: z.string().trim().min(2).optional(),
    produto_ids: z.array(z.uuid()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })
export type UpdateCategoriaDTO = z.infer<typeof updateCategoriaSchema>

export const categoriaParamsSchema = z.object({
  id: z.uuid(),
})
export type CategoriaParams = z.infer<typeof categoriaParamsSchema>

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
