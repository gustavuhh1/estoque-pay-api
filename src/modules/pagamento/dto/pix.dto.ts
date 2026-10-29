import z from "zod"
import type { VendaComItens } from "@/modules/venda/dto/venda.dto"
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
  venda_id: z.uuid(),
  /**
   * O que importa para o PDV: PAGO quando o estoque já baixou, CANCELADO quando
   * o QR Code morreu sem pagamento. `pago` e `status` acima são do provedor.
   */
  status_pagamento: z.enum(["PENDENTE", "PAGO", "CANCELADO"]),
  /** `total_venda + taxa_pix` — o valor que o consumidor pagou/paga. */
  total_cobrado: z.number(),
})

export function toStatusCobrancaResponse(status: StatusCobrancaPix, venda: VendaComItens) {
  return {
    payment_id: status.payment_id,
    status: status.status,
    pago: status.pago,
    expira_em: status.expira_em,
    venda_id: venda.id,
    status_pagamento: venda.status_pagamento,
    total_cobrado: totalCobrado(venda),
  }
}

/** `total_venda + taxa_split`, em Number. A conta fica em um lugar só. */
export function totalCobrado(venda: VendaComItens): number {
  return Number(venda.total_venda.add(venda.taxa_split ?? 0))
}
