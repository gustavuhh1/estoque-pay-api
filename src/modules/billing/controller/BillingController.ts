import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import { montarPlanosResponse, toAssinaturaResponse } from "../dto/billing.dto"
import type { PlanoService } from "../service/PlanoService"

export class BillingController {
  constructor(private planoService: PlanoService) {}

  /** RF01.1 */
  async listarPlanos(_request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send(montarPlanosResponse())
  }

  /** RN00: plano efetivo, limites e uso da loja ativa. */
  async consultarAssinatura(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const estabelecimentoId = request.membro.estabelecimentoId
    const [plano, uso] = await Promise.all([
      this.planoService.obterPlano(estabelecimentoId),
      this.planoService.obterUso(estabelecimentoId),
    ])

    return reply.status(200).send(toAssinaturaResponse(plano, uso))
  }
}
