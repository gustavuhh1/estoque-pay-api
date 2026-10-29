import z from "zod"
import { itemCarrinhoSchema } from "@/modules/venda/dto/venda.dto"
import { codigoCupomSchema } from "@/modules/crm/dto/cupom.dto"

/**
 * RF02.1/RF02.2 — issue #51.
 *
 * `PIX_ABACATEPAY` fica de fora deste enum de propósito: Pix não é confirmação
 * manual do caixa, nasce PENDENTE e só vira PAGO pelo webhook ou pelo polling.
 * Aceitar Pix aqui deixaria o caixa marcar como pago um Pix que nunca caiu.
 */
const metodoManualSchema = z.enum(["DINHEIRO", "DEBITO", "CREDITO"])

/** Campos que toda venda tem, manual ou Pix. */
const camposDaVenda = {
  itens: z.array(itemCarrinhoSchema).min(1, "A venda precisa de ao menos um item."),
  /** RF02.1 (#58): indexa a venda ao histórico do cliente. */
  cliente_id: z.uuid().optional(),
  /**
   * RF02.3 (#58): resgata o cupom nesta venda. Cupom nominal exige o
   * `cliente_id` do dono dele.
   */
  cupom_codigo: codigoCupomSchema.optional(),
}

export const registrarPagamentoSchema = z
  .object({
    ...camposDaVenda,
    metodo_pagamento: metodoManualSchema,
    /** Obrigatório só em DINHEIRO — é o que permite calcular o troco. */
    valor_pago: z
      .number()
      .min(0)
      .multipleOf(0.01, "O valor aceita no máximo 2 casas decimais.")
      .optional(),
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
  cliente_id: z.string().nullish(),
  /** Soma dos itens, antes do desconto do cupom. */
  subtotal: z.number(),
  /** 0 quando não há cupom. */
  desconto: z.number(),
  cupom_codigo: z.string().nullish(),
  /** O que foi efetivamente cobrado: subtotal - desconto. */
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

/**
 * Pix (#52, D1). Sem `metodo_pagamento` (é sempre Pix) e sem `valor_pago` (não
 * há troco): o cliente paga o QR Code, e o valor sai do banco, nunca do corpo.
 */
export const iniciarPagamentoPixSchema = z.object(camposDaVenda)
export type IniciarPagamentoPixDTO = z.infer<typeof iniciarPagamentoPixSchema>

export const pagamentoPixResponseSchema = z.object({
  venda_id: z.uuid(),
  cliente_id: z.string().nullish(),
  /** Soma dos itens, antes do desconto do cupom. */
  subtotal: z.number(),
  desconto: z.number(),
  cupom_codigo: z.string().nullish(),
  /** Itens menos o cupom — a receita da loja. NÃO inclui a taxa do Pix. */
  total_venda: z.number(),
  /** D1: taxa de serviço do Pix, paga pelo consumidor. */
  taxa_pix: z.number(),
  /** O que o consumidor paga no QR Code: `total_venda + taxa_pix`. */
  total_cobrado: z.number(),
  status_pagamento: z.enum(["PENDENTE", "PAGO", "CANCELADO"]),
  turno_id: z.string(),
  payment_id: z.string(),
  /** Pix copia e cola. */
  qr_code: z.string(),
  /** Data URI da imagem do QR Code. */
  qr_code_imagem: z.string(),
  expira_em: z.date(),
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
