import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toTurnoResponse,
  type AbrirTurnoDTO,
  type FecharTurnoDTO,
} from "../dto/caixa.dto"
import { CaixaService } from "../service/CaixaService"

// O body já chega validado pelo schema declarado na rota — por isso não há
// `schema.parse()` aqui (mesmo padrão do EstoqueController).
export class CaixaController {
  constructor(private caixaService: CaixaService) {}

  /** RF06.1 */
  async abrir(
    request: FastifyRequest<{ Body: AbrirTurnoDTO }>,
    reply: FastifyReply
  ) {
    // `request.membro` não carrega o userId, por isso quem abriu vem do
    // `request.user` populado pelo requireAuth.
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const turno = await this.caixaService.abrir(
      request.membro.estabelecimentoId,
      request.user.id,
      request.body
    )

    return reply.status(201).send(toTurnoResponse(turno))
  }

  /** RF06.2 */
  async fechar(
    request: FastifyRequest<{ Body: FecharTurnoDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const turno = await this.caixaService.fechar(
      request.membro.estabelecimentoId,
      request.user.id,
      request.body
    )

    return reply.status(200).send(toTurnoResponse(turno))
  }

  async buscarAberto(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const turno = await this.caixaService.buscarAberto(request.membro.estabelecimentoId)

    return reply.status(200).send(toTurnoResponse(turno))
  }
}
