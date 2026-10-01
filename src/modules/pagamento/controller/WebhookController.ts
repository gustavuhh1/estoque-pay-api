import type { FastifyReply, FastifyRequest } from "fastify"
import { EVENTO_PIX_PAGO, type WebhookAbacatePayDTO } from "../dto/webhook.dto"

/**
 * Recebe as notificações da AbacatePay (issue #52, RNF02).
 *
 * Esta é a PRIMEIRA rota pública da API: não passa por `requireAuth` nem por
 * `requireTenant`. Quem autentica é a assinatura HMAC do corpo, verificada no
 * hook `preValidation` registrado em `routes.ts` — quando o código abaixo roda,
 * a origem já está provada. Fica num controller separado do resto de pagamentos
 * para a ausência dos guards ficar evidente e não vazar para uma rota de sessão.
 */
export class WebhookController {
  async receber(
    request: FastifyRequest<{ Body: WebhookAbacatePayDTO }>,
    reply: FastifyReply
  ) {
    // Eventos que não consolidam venda saem com 200 mesmo assim: devolver erro
    // faria o provedor reenviar para sempre algo que nunca vamos processar.
    if (request.body.event !== EVENTO_PIX_PAGO) {
      return reply.status(200).send({ recebido: true, processado: false })
    }

    // TODO(#51/#52): consolidar a venda. Depende da #50 (Venda/ItemVenda) e da
    // #51 (a transação de consolidação) existirem. O fluxo será:
    //   1. achar a Venda por `abacatepay_payment_id` (= data.id do provedor);
    //      não achou -> 200 com processado:false (pode ser cobrança de outro
    //      sistema na mesma conta), nunca 404, senão o provedor fica reenviando
    //   2. IDEMPOTÊNCIA: se a venda já está PAGO, devolver 200 sem fazer nada.
    //      Webhook reenvia em retry, e sem essa guarda a baixa de estoque
    //      rodaria duas vezes. Este é o ponto mais perigoso da issue e NÃO está
    //      nos critérios de aceite originais da #52.
    //   3. numa $transaction: status -> PAGO, pago_em, taxa_split, e para cada
    //      item `registrarMovimentacao({ SAIDA, VENDA }, tx)` — reusando a
    //      mesma rotina de consolidação que a #51 vai construir.
    return reply.status(200).send({ recebido: true, processado: false })
  }
}
