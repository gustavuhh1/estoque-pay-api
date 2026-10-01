import z from "zod"

/**
 * Envelope padrão dos webhooks da AbacatePay (issue #52).
 * https://docs.abacatepay.com/pages/webhooks
 *
 * `data` fica como `passthrough` de propósito: o formato interno varia por
 * evento e não está documentado por completo. Validar demais aqui faria a rota
 * rejeitar eventos legítimos que o provedor mude/adicione — e um webhook
 * recusado vira retentativa infinita do lado deles.
 */
export const webhookAbacatePaySchema = z.object({
  id: z.string(),
  event: z.string(),
  apiVersion: z.number().optional(),
  devMode: z.boolean().optional(),
  data: z.looseObject({}).optional(),
})
export type WebhookAbacatePayDTO = z.infer<typeof webhookAbacatePaySchema>

/**
 * Eventos do checkout transparente (o fluxo de Pix com QR Code que usamos).
 * Os de `checkout.*` pertencem ao fluxo de link de pagamento, que não usamos.
 *
 * Só `transparent.completed` consolida venda. Os outros dois ficam nomeados
 * aqui porque a #53 (cancelamento/estorno) vai precisar tratá-los.
 */
export const EVENTO_PIX_PAGO = "transparent.completed"
export const EVENTO_PIX_ESTORNADO = "transparent.refunded"
export const EVENTO_PIX_CONTESTADO = "transparent.disputed"

/**
 * O webhook responde sempre 200 quando a assinatura é válida, mesmo para evento
 * que a gente ignora. Devolver erro faria o provedor reenviar para sempre algo
 * que nunca vamos processar.
 */
export const webhookResponseSchema = z.object({
  recebido: z.boolean(),
  processado: z.boolean(),
})
