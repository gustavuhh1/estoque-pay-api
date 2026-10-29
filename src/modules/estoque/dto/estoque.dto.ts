import z from "zod"
import type { MovimentacaoEstoque, Produto } from "../../../../generated/prisma/client.js"

const tipoMovimentacaoSchema = z.enum(["ENTRADA", "SAIDA"])

/**
 * RF14.3: motivos aceitos no lançamento MANUAL. `VENDA` e `ESTORNO_VENDA`
 * existem no enum do schema mas ficam de fora de propósito — quem escreve
 * esses dois é o PDV (Fase 3). Deixar alguém forjar uma movimentação "VENDA"
 * pela mão corromperia o histórico financeiro que o PDV vai gerar.
 */
const MOTIVOS_ENTRADA = ["REABASTECIMENTO", "AJUSTE_MANUAL"] as const
const MOTIVOS_SAIDA = ["DESCARTE", "PERDA", "VENCIMENTO", "AJUSTE_MANUAL"] as const

const motivoManualSchema = z.enum([
  "REABASTECIMENTO",
  "DESCARTE",
  "PERDA",
  "VENCIMENTO",
  "AJUSTE_MANUAL",
])

/**
 * RF12.1/RF13.2. A coerência motivo↔tipo mora aqui (e não no Service) porque
 * depende só de campos do corpo, sem nenhum estado de banco: sai como um único
 * 400 VALIDATION_ERROR e se auto-documenta no /apidocs.
 */
export const createMovimentacaoSchema = z
  .object({
    produto_id: z.uuid(),
    tipo: tipoMovimentacaoSchema,
    // RN04: 3 casas decimais, exatamente o que a coluna Decimal(10,3) guarda.
    quantidade: z
      .number()
      .positive("A quantidade deve ser maior que zero.")
      .multipleOf(0.001, "A quantidade aceita no máximo 3 casas decimais."),
    motivo: motivoManualSchema,
    observacao: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const permitidos: readonly string[] =
      data.tipo === "ENTRADA" ? MOTIVOS_ENTRADA : MOTIVOS_SAIDA

    if (!permitidos.includes(data.motivo)) {
      ctx.addIssue({
        code: "custom",
        path: ["motivo"],
        message: `O motivo ${data.motivo} não é válido para uma movimentação de ${data.tipo}.`,
      })
    }
  })
export type CreateMovimentacaoDTO = z.infer<typeof createMovimentacaoSchema>

/**
 * RF15.4. Primeira querystring do projeto. `z.coerce` é obrigatório porque
 * todo valor de query chega como string.
 *
 * Pegadinha para quem consome: mandar o parâmetro VAZIO não é o mesmo que
 * omitir. `?page=` vira 0 no coerce e estoura o `min(1)`; `?produto_id=` falha
 * o uuid. O cliente deve omitir o parâmetro que não quer usar.
 */
export const listMovimentacoesQuerySchema = z.object({
  produto_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListMovimentacoesQuery = z.infer<typeof listMovimentacoesQuerySchema>

/**
 * O enum de motivo da RESPOSTA inclui os 7 valores, não só os 5 manuais: esta
 * mesma listagem vai devolver as linhas de VENDA/ESTORNO_VENDA assim que o PDV
 * da Fase 3 existir.
 */
export const movimentacaoResponseSchema = z.object({
  id: z.uuid(),
  produto_id: z.uuid(),
  produto_nome: z.string(),
  usuario_id: z.string(),
  usuario_nome: z.string().nullish(),
  quantidade: z.number(),
  tipo: tipoMovimentacaoSchema,
  motivo: z.enum([
    "REABASTECIMENTO",
    "VENDA",
    "ESTORNO_VENDA",
    "DESCARTE",
    "PERDA",
    "VENCIMENTO",
    "AJUSTE_MANUAL",
  ]),
  observacao: z.string().nullish(),
  criado_em: z.date(),
})

export const listMovimentacoesResponseSchema = z.object({
  data: z.array(movimentacaoResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export const alertaResponseSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  tipo_medida: z.enum(["UNIDADE", "FRACIONADO_KG"]),
  quantidade_atual: z.number(),
  quantidade_minima: z.number(),
})
export const listAlertasResponseSchema = z.array(alertaResponseSchema)

export type MovimentacaoComRelacoes = MovimentacaoEstoque & {
  produto: { nome: string }
  users: { name: string | null }
}

/**
 * O Prisma devolve `Decimal` para colunas `@db.Decimal`, e o response schema
 * espera `number`. O serializerCompiler do @fastify/type-provider-zod roda em
 * modo "encode" (Zod v4), que não aceita `.transform()` dentro do schema de
 * resposta — por isso a conversão acontece aqui, antes do `reply.send()`.
 * Mesmo padrão do `toProdutoResponse`.
 */
export function toMovimentacaoResponse(movimentacao: MovimentacaoComRelacoes) {
  return {
    id: movimentacao.id,
    produto_id: movimentacao.produto_id,
    produto_nome: movimentacao.produto.nome,
    usuario_id: movimentacao.usuario_id,
    usuario_nome: movimentacao.users.name,
    quantidade: Number(movimentacao.quantidade),
    tipo: movimentacao.tipo,
    motivo: movimentacao.motivo,
    observacao: movimentacao.observacao,
    criado_em: movimentacao.criado_em,
  }
}

export function toAlertaResponse(produto: Produto) {
  return {
    id: produto.id,
    nome: produto.nome,
    tipo_medida: produto.tipo_medida,
    quantidade_atual: Number(produto.quantidade_atual),
    quantidade_minima: Number(produto.quantidade_minima),
  }
}
