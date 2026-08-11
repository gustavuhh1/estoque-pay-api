import type { FastifyReply, FastifyRequest } from "fastify"
import { AuthService } from "../services/auth.service.js"

export class AuthController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const authService = new AuthService()
    const result = await authService.execute()
    return reply.status(200).send(result)
  }
}
