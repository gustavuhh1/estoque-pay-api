import type { FastifyReply, FastifyRequest } from "fastify"
import { CrmService } from "../services/crm.service.js"

export class CrmController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const crmService = new CrmService()
    const result = await crmService.execute()
    return reply.status(200).send(result)
  }
}
