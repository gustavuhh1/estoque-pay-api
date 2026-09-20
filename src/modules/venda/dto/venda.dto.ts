import z from "zod"
import type { ItemVenda, Produto, Venda } from "../../../../generated/prisma/client.js"

/** RF05.1: identifica a venda a cancelar. */
export const vendaIdParamsSchema = z.object({
  venda_id: z.uuid(),
})
export type VendaIdParams = z.infer<typeof vendaIdParamsSchema>

/** RF01.1: termo de busca do PDV (código de barras ou parte do nome). */
export const buscarProdutoQuerySchema = z.object({
  termo: z.string().trim().min(1, "Informe o código de barras ou o nome do produto."),
})
export type BuscarProdutoQuery = z.infer<typeof buscarProdutoQuerySchema>

/**
 * Um item do carrinho. Repare que NÃO existe preço aqui: o preço é sempre
 * relido do banco. Aceitar preço do cliente deixaria qualquer um comprar por
 * R$ 0,01 mexendo na requisição.
 */
export const itemCarrinhoSchema = z.object({
  produto_id: z.uuid(),
  // RN04: 3 casas decimais, batendo com a coluna Decimal(10,3).
  quantidade: z
    .number()
    .positive("A quantidade deve ser maior que zero.")
    .multipleOf(0.001, "A quantidade aceita no máximo 3 casas decimais."),
})
export type ItemCarrinhoDTO = z.infer<typeof itemCarrinhoSchema>

/** RF01.2/RF01.3: precifica o carrinho sem gravar nada (RN01). */
export const calcularVendaSchema = z.object({
  itens: z.array(itemCarrinhoSchema).min(1, "A venda precisa de ao menos um item."),
})
export type CalcularVendaDTO = z.infer<typeof calcularVendaSchema>

export const produtoBuscaResponseSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  ean_gtin: z.string().nullish(),
  tipo_medida: z.enum(["UNIDADE", "FRACIONADO_KG"]),
  preco_venda: z.number(),
  quantidade_atual: z.number(),
})
export const listProdutoBuscaResponseSchema = z.array(produtoBuscaResponseSchema)

export const itemCalculadoSchema = z.object({
  produto_id: z.uuid(),
  produto_nome: z.string(),
  quantidade: z.number(),
  preco_unitario: z.number(),
  subtotal: z.number(),
})

export const calculoVendaResponseSchema = z.object({
  itens: z.array(itemCalculadoSchema),
  total: z.number(),
})

export const itemVendaResponseSchema = z.object({
  id: z.uuid(),
  produto_id: z.uuid(),
  produto_nome: z.string(),
  quantidade: z.number(),
  preco_unitario: z.number(),
  subtotal: z.number(),
})

export const vendaResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  turno_id: z.string().nullish(),
  usuario_id: z.string(),
  cliente_id: z.string().nullish(),
  total_venda: z.number(),
  metodo_pagamento: z.enum(["PIX_ABACATEPAY", "DINHEIRO", "DEBITO", "CREDITO"]),
  status_pagamento: z.enum(["PENDENTE", "PAGO", "CANCELADO"]),
  itens: z.array(itemVendaResponseSchema),
  criada_em: z.date(),
})

export type VendaComItens = Venda & {
  itens: Array<ItemVenda & { produto: { nome: string } }>
}

/**
 * O Prisma devolve `Decimal` para colunas `@db.Decimal`, e o response schema
 * espera `number`. O serializerCompiler roda em modo "encode" (Zod v4), que não
 * aceita `.transform()` no schema de resposta — por isso a conversão acontece
 * aqui, antes do `reply.send()`. Mesmo padrão do `toMovimentacaoResponse`.
 */
export function toVendaResponse(venda: VendaComItens) {
  return {
    id: venda.id,
    estabelecimento_id: venda.estabelecimento_id,
    turno_id: venda.turno_id,
    usuario_id: venda.usuario_id,
    cliente_id: venda.cliente_id,
    total_venda: Number(venda.total_venda),
    metodo_pagamento: venda.metodo_pagamento,
    status_pagamento: venda.status_pagamento,
    itens: venda.itens.map((item) => ({
      id: item.id,
      produto_id: item.produto_id,
      produto_nome: item.produto.nome,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
      subtotal: Number(item.subtotal),
    })),
    criada_em: venda.criada_em,
  }
}

export function toProdutoBuscaResponse(produto: Produto) {
  return {
    id: produto.id,
    nome: produto.nome,
    ean_gtin: produto.ean_gtin,
    tipo_medida: produto.tipo_medida,
    preco_venda: Number(produto.preco_venda),
    quantidade_atual: Number(produto.quantidade_atual),
  }
}
