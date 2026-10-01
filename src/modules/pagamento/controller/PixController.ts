import type { FastifyReply, FastifyRequest } from "fastify"
import type { IPagamentoGateway } from "../gateway/IPagamentoGateway"
import { toStatusCobrancaResponse, type PaymentIdParams } from "../dto/pix.dto"

export class PixController {
  constructor(private gateway: IPagamentoGateway) {}

  /** Polling do status da cobrança. */
  async consultarStatus(
    request: FastifyRequest<{ Params: PaymentIdParams }>,
    reply: FastifyReply
  ) {
    const status = await this.gateway.consultarCobrancaPix(request.params.payment_id)

    return reply.status(200).send(toStatusCobrancaResponse(status))
  }

  /** SOMENTE DESENVOLVIMENTO — ver o aviso em routes.ts. */
  async simularPagamento(
    request: FastifyRequest<{ Params: PaymentIdParams }>,
    reply: FastifyReply
  ) {
    const status = await this.gateway.simularPagamentoPix(request.params.payment_id)

    return reply.status(200).send(toStatusCobrancaResponse(status))
  }
}
