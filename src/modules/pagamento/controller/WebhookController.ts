import type { FastifyReply, FastifyRequest } from "fastify"
import { EVENTO_PIX_PAGO, type WebhookAbacatePayDTO } from "../dto/webhook.dto"
import type { PagamentoService } from "../service/PagamentoService"

/**
 * Recebe as notificações da AbacatePay (issue #52/#79, RNF02).
 *
 * Esta é a PRIMEIRA rota pública da API: não passa por `requireAuth` nem por
 * `requireTenant`. Quem autentica são o `webhookSecret` da query e a assinatura
 * HMAC do corpo, verificados no hook `preValidation` registrado em `routes.ts` —
 * quando o código abaixo roda, a origem já está provada. Fica num controller
 * separado do resto de pagamentos para a ausência dos guards ficar evidente e
 * não vazar para uma rota de sessão.
 */
export class WebhookController {
  constructor(private pagamentoService: PagamentoService) {}

  async receber(
    request: FastifyRequest<{ Body: WebhookAbacatePayDTO }>,
    reply: FastifyReply
  ) {
    // Eventos que não consolidam venda saem com 200 mesmo assim: devolver erro
    // faria o provedor reenviar para sempre algo que nunca vamos processar.
    if (request.body.event !== EVENTO_PIX_PAGO) {
      return reply.status(200).send({ recebido: true, processado: false })
    }

    const { processado } = await this.pagamentoService.confirmarPixPorWebhook(
      idsCandidatos(request.body.data)
    )

    return reply.status(200).send({ recebido: true, processado })
  }
}

/**
 * O payload do `transparent.completed` não está documentado. O id da cobrança
 * pode vir em `data.id` ou em `data.transparent.id`; tentamos os dois e o
 * Service confirma com o provedor antes de dar baixa, então um id errado ou
 * forjado não consolida nada.
 */
function idsCandidatos(data: WebhookAbacatePayDTO["data"]): string[] {
  const transparent = data?.transparent
  const doTransparent =
    typeof transparent === "object" && transparent !== null
      ? (transparent as { id?: unknown }).id
      : undefined

  return [doTransparent, data?.id].filter(
    (id): id is string => typeof id === "string" && id.length > 0
  )
}
