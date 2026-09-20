import z from "zod"
import type { TurnoCaixa } from "../../../../generated/prisma/client.js"

/**
 * RF06.1. O valor de abertura é o fundo de troco que fica na gaveta. Aceita 0
 * (loja que começa o dia sem troco) e no máximo 2 casas decimais, exatamente o
 * que a coluna Decimal(10,2) guarda.
 */
export const abrirTurnoSchema = z.object({
  valor_abertura: z
    .number()
    .min(0, "O valor de abertura não pode ser negativo.")
    .multipleOf(0.01, "O valor aceita no máximo 2 casas decimais."),
})
export type AbrirTurnoDTO = z.infer<typeof abrirTurnoSchema>

/** RF06.2. Valor contado na gaveta no fim do expediente. */
export const fecharTurnoSchema = z.object({
  valor_fechamento: z
    .number()
    .min(0, "O valor de fechamento não pode ser negativo.")
    .multipleOf(0.01, "O valor aceita no máximo 2 casas decimais."),
})
export type FecharTurnoDTO = z.infer<typeof fecharTurnoSchema>

export const turnoResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  status: z.enum(["ABERTO", "FECHADO"]),
  valor_abertura: z.number(),
  valor_fechamento: z.number().nullish(),
  aberto_por_id: z.string(),
  aberto_por_nome: z.string().nullish(),
  aberto_em: z.date(),
  fechado_por_id: z.string().nullish(),
  fechado_por_nome: z.string().nullish(),
  fechado_em: z.date().nullish(),
})

export type TurnoComRelacoes = TurnoCaixa & {
  aberto_por: { name: string | null }
  fechado_por: { name: string | null } | null
}

/**
 * O Prisma devolve `Decimal` para colunas `@db.Decimal`, e o response schema
 * espera `number`. O serializerCompiler do @fastify/type-provider-zod roda em
 * modo "encode" (Zod v4), que não aceita `.transform()` dentro do schema de
 * resposta — por isso a conversão acontece aqui, antes do `reply.send()`.
 * Mesmo padrão do `toMovimentacaoResponse`.
 */
export function toTurnoResponse(turno: TurnoComRelacoes) {
  return {
    id: turno.id,
    estabelecimento_id: turno.estabelecimento_id,
    status: turno.status,
    valor_abertura: Number(turno.valor_abertura),
    valor_fechamento: turno.valor_fechamento === null ? null : Number(turno.valor_fechamento),
    aberto_por_id: turno.aberto_por_id,
    aberto_por_nome: turno.aberto_por.name,
    aberto_em: turno.aberto_em,
    fechado_por_id: turno.fechado_por_id,
    fechado_por_nome: turno.fechado_por?.name ?? null,
    fechado_em: turno.fechado_em,
  }
}
