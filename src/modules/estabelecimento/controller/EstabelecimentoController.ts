import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type {
  CreateEstabelecimentoDTO,
  UpdateEstabelecimentoDTO,
} from "../dto/estabelecimento.dto"
import { EstabelecimentoService } from "../service/EstabelecimentoService"

// O body já chega validado pelo schema declarado na rota — por isso não há
// `schema.parse()` aqui: erro de validação nem alcança o controller.
export class EstabelecimentoController {
  constructor(private estabelecimentoService: EstabelecimentoService) {}

  async create(
    request: FastifyRequest<{ Body: CreateEstabelecimentoDTO }>,
    reply: FastifyReply
  ) {
    // O requireAuth já garantiu a sessão; isto é só o estreitamento do tipo
    // opcional de `request.user` (e uma rede caso a rota esqueça o preHandler).
    if (!request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const result = await this.estabelecimentoService.create({
      ...request.body,
      ownerId: request.user.id,
    })

    return reply.status(201).send(result)
  }

  /** RF03.1 */
  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const lojas = await this.estabelecimentoService.listByUser(request.user.id)

    return reply
      .status(200)
      .send(lojas.map((loja) => ({ ...loja.estabelecimento, role: loja.role })))
  }

  /** RF03.2 + RF04.1 (leitura) */
  async getAtivo(request: FastifyRequest, reply: FastifyReply) {
    // requireTenant já garantiu vínculo + populou request.membro; isto é só
    // o estreitamento do tipo opcional (e a mesma rede de segurança de sempre).
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const result = await this.estabelecimentoService.getAtivo(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(result)
  }

  /** RF04.1 (escrita) + RF04.2 */
  async updateAtivo(
    request: FastifyRequest<{ Body: UpdateEstabelecimentoDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const result = await this.estabelecimentoService.updateAtivo(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(200).send(result)
  }
}
