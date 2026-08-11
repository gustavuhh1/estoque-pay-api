import type { FastifyReply, FastifyRequest } from "fastify"
import { PdvService } from "../services/pdv.service.js"

export class PdvController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const pdvService = new PdvService()
    const result = await pdvService.execute()
    return reply.status(200).send(result)
  }
}
