import z from "zod"
import type { Notificacao } from "../../../../generated/prisma/client.js"

export const TIPOS_NOTIFICACAO = [
  "ESTOQUE_BAIXO",
  "ESTOQUE_ZERADO",
  "VENDA_CANCELADA",
  "PIX_CONFIRMADO",
  "CAIXA_DIFERENCA",
] as const

/** Quantas notificações o sininho mostra: as mais recentes bastam. */
export const LIMITE_PADRAO_NOTIFICACOES = 30

export const listarNotificacoesQuerySchema = z.object({
  limite: z.coerce
    .number()
    .int()
    .min(1, "O limite mínimo é 1.")
    .max(100, "O limite máximo é 100.")
    .default(LIMITE_PADRAO_NOTIFICACOES),
})
export type ListarNotificacoesQuery = z.infer<typeof listarNotificacoesQuerySchema>

export const notificacaoIdParamsSchema = z.object({
  id: z.uuid(),
})
export type NotificacaoIdParams = z.infer<typeof notificacaoIdParamsSchema>

export const notificacaoResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  tipo: z.enum(TIPOS_NOTIFICACAO),
  titulo: z.string(),
  mensagem: z.string(),
  link: z.string().nullable().describe("Rota do front para onde o clique leva (ex.: `/estoque`)."),
  lida: z.boolean(),
  lida_em: z.date().nullable(),
  criada_em: z.date(),
})

export const listNotificacoesResponseSchema = z.object({
  itens: z.array(notificacaoResponseSchema),
  nao_lidas: z
    .number()
    .int()
    .describe("Total de não lidas da loja (não só das devolvidas em `itens`). Alimenta o badge do sininho."),
})

export const marcarTodasResponseSchema = z.object({
  atualizadas: z.number().int().describe("Quantas notificações passaram a lidas nesta chamada."),
})

/** `chave` é detalhe interno de deduplicação: não sai na resposta. */
export function toNotificacaoResponse(notificacao: Notificacao) {
  return {
    id: notificacao.id,
    estabelecimento_id: notificacao.estabelecimento_id,
    tipo: notificacao.tipo,
    titulo: notificacao.titulo,
    mensagem: notificacao.mensagem,
    link: notificacao.link,
    lida: notificacao.lida_em !== null,
    lida_em: notificacao.lida_em,
    criada_em: notificacao.criada_em,
  }
}
