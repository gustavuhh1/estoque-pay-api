import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toConviteResponse,
  toFuncionarioResponse,
  type CreateFuncionarioDTO,
  type FuncionarioParams,
  type UpdateFuncionarioDTO,
} from "../dto/equipe.dto"
import { EquipeService } from "../service/EquipeService"

// O body/params já chegam validados pelo schema declarado na rota — por isso
// não há `schema.parse()` aqui.
export class EquipeController {
  constructor(private equipeService: EquipeService) {}

  /** RF05.1 */
  async cadastrar(
    request: FastifyRequest<{ Body: CreateFuncionarioDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const resultado = await this.equipeService.cadastrar(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.user.id,
      request.body
    )

    if (resultado.status === "VINCULADO") {
      return reply.status(201).send(toFuncionarioResponse(resultado.membro))
    }

    return reply.status(202).send(toConviteResponse(resultado.convite))
  }

  /** RF05.2 */
  async listar(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { membros, convitesPendentes } = await this.equipeService.listar(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send({
      membros: membros.map(toFuncionarioResponse),
      convitesPendentes: convitesPendentes.map(toConviteResponse),
    })
  }

  /** RF05.3 */
  async editar(
    request: FastifyRequest<{ Params: FuncionarioParams; Body: UpdateFuncionarioDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const membro = await this.equipeService.editar(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.params.id,
      request.body
    )

    return reply.status(200).send(toFuncionarioResponse(membro))
  }

  /** RF05.4 */
  async excluir(request: FastifyRequest<{ Params: FuncionarioParams }>, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    await this.equipeService.excluir(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.params.id
    )

    return reply.status(204).send()
  }
}
