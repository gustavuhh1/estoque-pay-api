import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type { SwitchFiscalDTO } from "../dto/estabelecimento.dto"
import { SwitchFiscalService } from "../service/SwitchFiscalService"

/** RN01/RN01.1 (Fase 4) — issue #59. */
export class SwitchFiscalController {
  constructor(private switchFiscalService: SwitchFiscalService) {}

  async preCheck(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const resultado = await this.switchFiscalService.preCheck(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(resultado)
  }

  async alterar(
    request: FastifyRequest<{ Body: SwitchFiscalDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const estabelecimento = await this.switchFiscalService.alterarSwitch(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body.emite_nfce
    )

    return reply.status(200).send(estabelecimento)
  }
}
