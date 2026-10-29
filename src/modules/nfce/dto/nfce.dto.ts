import z from "zod"
import { AVISO_SIMULACAO, type EspelhoNfce } from "../espelho"
import type { NotaRegistrada } from "../repository/INfceRepository"

export const vendaIdParamsSchema = z.object({ venda_id: z.uuid() })
export type VendaIdParams = z.infer<typeof vendaIdParamsSchema>

export const listNotasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListNotasQuery = z.infer<typeof listNotasQuerySchema>

const formaPagamentoSchema = z.enum(["PIX", "DINHEIRO", "DEBITO", "CREDITO"])

/**
 * Todo JSON da nota carrega `simulada: true` e o `aviso`: o consumidor da API
 * (o front) não consegue exibir uma nota sem receber, junto, o aviso de que ela
 * não tem valor fiscal.
 */
const marcaDeSimulacao = {
  simulada: z.literal(true),
  aviso: z.literal(AVISO_SIMULACAO),
}

export const espelhoResponseSchema = z.object({
  ...marcaDeSimulacao,
  numero: z.number(),
  serie: z.number(),
  /** FICTÍCIA: começa com `SIMULADO`, não é uma chave real. */
  chave_de_acesso: z.string(),
  emitida_em: z.string(),
  venda_id: z.uuid(),
  estabelecimento: z.object({ nome: z.string(), cnpj: z.string(), ie: z.string().nullable() }),
  consumidor: z.object({
    identificado: z.boolean(),
    nome: z.string().nullable(),
    cpf: z.string().nullable(),
  }),
  itens: z.array(
    z.object({
      nome: z.string(),
      quantidade: z.number(),
      preco_unitario: z.number(),
      total: z.number(),
    })
  ),
  subtotal_itens: z.number(),
  desconto: z.number(),
  total_venda: z.number(),
  /** D1: taxa do Pix paga pelo consumidor. null fora do Pix. */
  taxa_pix: z.number().nullable(),
  total_cobrado: z.number(),
  forma_pagamento: formaPagamentoSchema,
  pago_em: z.string().nullable(),
})

export const notaResponseSchema = z.object({
  venda_id: z.uuid(),
  numero: z.number(),
  status: z.enum(["PROCESSANDO", "AUTORIZADA", "ERRO"]),
  espelho: espelhoResponseSchema,
})

export function toNotaResponse(nota: NotaRegistrada) {
  return { venda_id: nota.venda_id, numero: nota.numero, status: nota.status, espelho: nota.espelho }
}

export const notaResumoSchema = z.object({
  ...marcaDeSimulacao,
  venda_id: z.uuid(),
  numero: z.number(),
  chave_de_acesso: z.string(),
  emitida_em: z.string(),
  total_cobrado: z.number(),
  forma_pagamento: formaPagamentoSchema,
  consumidor_identificado: z.boolean(),
})

export const listNotasResponseSchema = z.object({
  data: z.array(notaResumoSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
})

export function toNotaResumo(nota: NotaRegistrada) {
  const espelho: EspelhoNfce = nota.espelho

  return {
    simulada: espelho.simulada,
    aviso: espelho.aviso,
    venda_id: nota.venda_id,
    numero: nota.numero,
    chave_de_acesso: espelho.chave_de_acesso,
    emitida_em: espelho.emitida_em,
    total_cobrado: espelho.total_cobrado,
    forma_pagamento: espelho.forma_pagamento,
    consumidor_identificado: espelho.consumidor.identificado,
  }
}
