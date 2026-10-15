import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type {
  ClienteParams,
  CreateClienteDTO,
  ListClientesQuery,
  UpdateClienteDTO,
} from "../dto/cliente.dto"
import { ClienteService } from "../service/ClienteService"

// O body/params/query já chegam validados pelo schema declarado na rota — por
// isso não há `schema.parse()` aqui.
export class ClienteController {
  constructor(private clienteService: ClienteService) {}

  /** RF01.1 */
  async create(
    request: FastifyRequest<{ Body: CreateClienteDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const cliente = await this.clienteService.create(
      request.membro.estabelecimentoId,
      request.body
    )

    return reply.status(201).send(cliente)
  }

  /** RF01.2 */
  async list(
    request: FastifyRequest<{ Querystring: ListClientesQuery }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const resultado = await this.clienteService.list(
      request.membro.estabelecimentoId,
      request.query
    )

    return reply.status(200).send(resultado)
  }

  /** RF01.3 */
  async findById(
    request: FastifyRequest<{ Params: ClienteParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const cliente = await this.clienteService.findById(
      request.params.id,
      request.membro.estabelecimentoId
    )

    return reply.status(200).send(cliente)
  }

  /** RF01.4 */
  async update(
    request: FastifyRequest<{ Params: ClienteParams; Body: UpdateClienteDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const cliente = await this.clienteService.update(
      request.params.id,
      request.membro.estabelecimentoId,
      request.body
    )

    return reply.status(200).send(cliente)
  }
}
