import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toNotificacaoResponse,
  type ListarNotificacoesQuery,
  type NotificacaoIdParams,
} from "../dto/notificacao.dto"
import { NotificacaoService } from "../service/NotificacaoService"

// Query e params já chegam validados pelo schema declarado na rota.
export class NotificacaoController {
  constructor(private notificacaoService: NotificacaoService) {}

  async listar(
    request: FastifyRequest<{ Querystring: ListarNotificacoesQuery }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { itens, nao_lidas } = await this.notificacaoService.listar(
      request.membro.estabelecimentoId,
      request.query.limite
    )

    return reply.status(200).send({ itens: itens.map(toNotificacaoResponse), nao_lidas })
  }

  async marcarLida(
    request: FastifyRequest<{ Params: NotificacaoIdParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const notificacao = await this.notificacaoService.marcarLida(
      request.membro.estabelecimentoId,
      request.params.id
    )

    return reply.status(200).send(toNotificacaoResponse(notificacao))
  }

  async marcarTodasLidas(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const resultado = await this.notificacaoService.marcarTodasLidas(
      request.membro.estabelecimentoId
    )

    return reply.status(200).send(resultado)
  }
}
