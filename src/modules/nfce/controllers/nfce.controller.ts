import type { FastifyReply, FastifyRequest } from "fastify"
import { NfceService } from "../services/nfce.service.js"

export class NfceController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const nfceService = new NfceService()
    const result = await nfceService.execute()
    return reply.status(200).send(result)
  }
}
