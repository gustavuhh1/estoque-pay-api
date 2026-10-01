import z from "zod"
import { itemCarrinhoSchema } from "@/modules/venda/dto/venda.dto"

/**
 * RF02.1/RF02.2 — issue #51.
 *
 * `PIX_ABACATEPAY` fica de fora deste enum de propósito: Pix não é confirmação
 * manual do caixa, nasce PENDENTE e só vira PAGO pelo webhook ou pelo polling.
 * Aceitar Pix aqui deixaria o caixa marcar como pago um Pix que nunca caiu.
 */
const metodoManualSchema = z.enum(["DINHEIRO", "DEBITO", "CREDITO"])

export const registrarPagamentoSchema = z
  .object({
    itens: z.array(itemCarrinhoSchema).min(1, "A venda precisa de ao menos um item."),
    metodo_pagamento: metodoManualSchema,
    /** Obrigatório só em DINHEIRO — é o que permite calcular o troco. */
    valor_pago: z
      .number()
      .min(0)
      .multipleOf(0.01, "O valor aceita no máximo 2 casas decimais.")
      .optional(),
    cliente_id: z.uuid().optional(),
  })
  .superRefine((data, ctx) => {
    // A coerência mora no schema (e não no Service) porque depende só de
    // campos do corpo, sem nenhum estado de banco — sai como um único 400 e se
    // auto-documenta no /apidocs. Mesmo espírito do motivo↔tipo no estoque.
    if (data.metodo_pagamento === "DINHEIRO" && data.valor_pago === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["valor_pago"],
        message: "Informe o valor_pago para pagamento em dinheiro (cálculo do troco).",
      })
    }
  })
export type RegistrarPagamentoDTO = z.infer<typeof registrarPagamentoSchema>

export const pagamentoResponseSchema = z.object({
  venda_id: z.uuid(),
  total_venda: z.number(),
  metodo_pagamento: metodoManualSchema,
  valor_pago: z.number().nullish(),
  /** Só em DINHEIRO. Null nos demais métodos. */
  troco: z.number().nullish(),
  turno_id: z.string(),
  itens: z.array(
    z.object({
      produto_id: z.uuid(),
      produto_nome: z.string(),
      quantidade: z.number(),
      preco_unitario: z.number(),
      subtotal: z.number(),
    })
  ),
  criada_em: z.date(),
})
