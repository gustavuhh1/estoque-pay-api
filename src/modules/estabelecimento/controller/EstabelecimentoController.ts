import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type { CreateEstabelecimentoDTO } from "../dto/estabelecimento.dto"
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
}
