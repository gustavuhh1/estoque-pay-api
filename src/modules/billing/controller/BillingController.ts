import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  montarPlanosResponse,
  toAssinaturaResponse,
  type IniciarAssinaturaDTO,
} from "../dto/billing.dto"
import type { AssinaturaService } from "../service/AssinaturaService"
import type { PlanoService } from "../service/PlanoService"

export class BillingController {
  constructor(
    private planoService: PlanoService,
    private assinaturaService: AssinaturaService
  ) {}

  /** RF01.1 */
  async listarPlanos(_request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send(montarPlanosResponse())
  }

  /** RN00: plano efetivo, limites e uso da loja ativa. */
  async consultarAssinatura(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    // #66: se o trial venceu e a loja ainda aparece como TRIALING, confirma
    // com o provedor antes de responder.
    await this.assinaturaService.reconciliarTrialVencido(request.membro.estabelecimentoId)

    return reply.status(200).send(await this.montarAssinatura(request.membro.estabelecimentoId))
  }

  /** RF01.2 + RN04 (#65) */
  async iniciar(
    request: FastifyRequest<{ Body: IniciarAssinaturaDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const iniciada = await this.assinaturaService.iniciar(
      request.membro.estabelecimentoId,
      request.membro.role,
      { email: request.user.email },
      request.body.tipo_plano
    )

    return reply.status(201).send(iniciada)
  }

  /** #66 */
  async cancelar(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    await this.assinaturaService.cancelar(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(await this.montarAssinatura(request.membro.estabelecimentoId))
  }

  private async montarAssinatura(estabelecimentoId: string) {
    const [plano, uso] = await Promise.all([
      this.planoService.obterPlano(estabelecimentoId),
      this.planoService.obterUso(estabelecimentoId),
    ])

    return toAssinaturaResponse(plano, uso)
  }
}
