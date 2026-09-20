import z from "zod"
import type { StatusCobrancaPix } from "../gateway/IPagamentoGateway"

/** O id da cobrança no provedor (ex: `pix_char_abc123`). Não é UUID. */
export const paymentIdParamsSchema = z.object({
  payment_id: z.string().min(1),
})
export type PaymentIdParams = z.infer<typeof paymentIdParamsSchema>

export const statusCobrancaResponseSchema = z.object({
  payment_id: z.string(),
  status: z.enum([
    "PENDING",
    "PAID",
    "EXPIRED",
    "CANCELLED",
    "UNDER_DISPUTE",
    "REFUNDED",
    "REDEEMED",
    "APPROVED",
    "FAILED",
  ]),
  /** Atalho para o cliente não precisar comparar com "PAID" na mão. */
  pago: z.boolean(),
  expira_em: z.date().nullish(),
})

export function toStatusCobrancaResponse(status: StatusCobrancaPix) {
  return {
    payment_id: status.payment_id,
    status: status.status,
    pago: status.pago,
    expira_em: status.expira_em,
  }
}
