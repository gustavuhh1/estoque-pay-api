import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import { toCupomResponse, type CreateCupomDTO, type ListCuponsQuery } from "../dto/cupom.dto"
import { CupomService } from "../service/CupomService"

export class CupomController {
  constructor(private cupomService: CupomService) {}

  /** RF02.3 (emissão) */
  async create(
    request: FastifyRequest<{ Body: CreateCupomDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const cupom = await this.cupomService.create(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(201).send(toCupomResponse(cupom))
  }

  /** RF02.3 (consulta) */
  async list(
    request: FastifyRequest<{ Querystring: ListCuponsQuery }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const cupons = await this.cupomService.list(
      request.membro.estabelecimentoId,
      request.query
    )

    return reply.status(200).send(cupons.map(toCupomResponse))
  }
}
