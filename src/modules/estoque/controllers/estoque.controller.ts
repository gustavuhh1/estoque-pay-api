import type { FastifyReply, FastifyRequest } from "fastify"
import { EstoqueService } from "../services/estoque.service.js"

export class EstoqueController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const estoqueService = new EstoqueService()
    const result = await estoqueService.execute()
    return reply.status(200).send(result)
  }
}
