import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toNotaResponse,
  toNotaResumo,
  type ListNotasQuery,
  type VendaIdParams,
} from "../dto/nfce.dto"
import type { NfceService } from "../service/NfceService"

export class NfceController {
  constructor(private nfceService: NfceService) {}

  async listar(request: FastifyRequest<{ Querystring: ListNotasQuery }>, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { data, total, page, limit } = await this.nfceService.listar(
      request.membro.estabelecimentoId,
      request.query.page,
      request.query.limit
    )

    return reply.status(200).send({ data: data.map(toNotaResumo), total, page, limit })
  }

  async consultar(request: FastifyRequest<{ Params: VendaIdParams }>, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const nota = await this.nfceService.consultar(
      request.params.venda_id,
      request.membro.estabelecimentoId
    )

    return reply.status(200).send(toNotaResponse(nota))
  }

  async imprimir(request: FastifyRequest<{ Params: VendaIdParams }>, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const html = await this.nfceService.imprimir(
      request.params.venda_id,
      request.membro.estabelecimentoId
    )

    return (
      reply
        .status(200)
        .header("content-type", "text/html; charset=utf-8")
        // O documento é autocontido (só CSS embutido). A política impede que
        // qualquer coisa injetada nele carregue ou execute algo.
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
        .header("cache-control", "no-store")
        .send(html)
    )
  }

  async emitir(request: FastifyRequest<{ Params: VendaIdParams }>, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { criada, nota } = await this.nfceService.emitirManual(
      request.params.venda_id,
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(criada ? 201 : 200).send(toNotaResponse(nota))
  }
}
