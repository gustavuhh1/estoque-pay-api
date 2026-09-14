import z from "zod"
import type { Produto } from "../../../../generated/prisma/client.js"

const tipoMedidaSchema = z.enum(["UNIDADE", "FRACIONADO_KG"])

export const createProdutoSchema = z.object({
  nome: z.string().trim().min(2, "O nome do produto é obrigatório."),
  ean_gtin: z.string().trim().min(1).optional(),
  tipo_medida: tipoMedidaSchema.default("UNIDADE"),
  preco_custo: z.number().nonnegative("Preço de custo não pode ser negativo."),
  preco_venda: z.number().positive("Preço de venda deve ser maior que zero."),
  quantidade_atual: z.number().nonnegative().default(0),
  quantidade_minima: z.number().nonnegative().default(0),
  ncm: z.string().trim().min(1).optional(),
  cfop: z.string().trim().min(1).optional(),
  // `ativo` NÃO é parâmetro de criação: é calculado pelo Service via RN09.1
  // (se a loja emite NFC-e e falta NCM/CFOP, nasce inativo automaticamente).
})
export type CreateProdutoDTO = z.infer<typeof createProdutoSchema>

/**
 * Schema de resposta: também serve de whitelist de serialização (o Fastify
 * usa isto pra montar o JSON de saída). `deletado_em` nunca é exposto — é um
 * detalhe interno de implementação do hard/soft delete.
 */
export const produtoResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  nome: z.string(),
  ean_gtin: z.string().nullish(),
  tipo_medida: tipoMedidaSchema,
  preco_custo: z.number(),
  preco_venda: z.number(),
  quantidade_atual: z.number(),
  quantidade_minima: z.number(),
  ncm: z.string().nullish(),
  cfop: z.string().nullish(),
  ativo: z.boolean(),
  criado_em: z.date(),
  atualizado_em: z.date(),
})
export const listProdutosResponseSchema = z.array(produtoResponseSchema)

/**
 * O Prisma devolve `Decimal` (não `number`) para colunas `@db.Decimal` — o
 * response schema acima espera `number` puro. O serializerCompiler do
 * @fastify/type-provider-zod roda em modo "encode" (Zod v4), que não aceita
 * `.transform()` dentro do schema de resposta (`ZodEncodeError: unidirectional
 * transform`); por isso a conversão acontece aqui, antes de chegar no
 * `reply.send()`, e não dentro do schema.
 */
export function toProdutoResponse(produto: Produto) {
  return {
    ...produto,
    preco_custo: Number(produto.preco_custo),
    preco_venda: Number(produto.preco_venda),
    quantidade_atual: Number(produto.quantidade_atual),
    quantidade_minima: Number(produto.quantidade_minima),
  }
}

/**
 * RF03.3: atualização parcial dos dados do produto. `ativo` fica de fora de
 * propósito — só é manipulado pelas rotas dedicadas `/inativar` e `/reativar`
 * (RF05.5/RF06.6), mesmo princípio já usado para isolar `emite_nfce` no
 * módulo estabelecimento: um campo com regra de negócio própria (aqui, a
 * trava fiscal RN09.2) ganha rota própria, não é só mais um campo de PATCH.
 */
export const updateProdutoSchema = z
  .object({
    nome: z.string().trim().min(2).optional(),
    ean_gtin: z.string().trim().min(1).nullable().optional(),
    tipo_medida: tipoMedidaSchema.optional(),
    preco_custo: z.number().nonnegative().optional(),
    preco_venda: z.number().positive().optional(),
    quantidade_atual: z.number().nonnegative().optional(),
    quantidade_minima: z.number().nonnegative().optional(),
    ncm: z.string().trim().min(1).nullable().optional(),
    cfop: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })
export type UpdateProdutoDTO = z.infer<typeof updateProdutoSchema>

export const produtoParamsSchema = z.object({
  id: z.uuid(),
})
export type ProdutoParams = z.infer<typeof produtoParamsSchema>
