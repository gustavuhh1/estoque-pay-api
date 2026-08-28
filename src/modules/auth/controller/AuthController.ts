import type { FastifyReply, FastifyRequest } from "fastify"
import { signUpSchema, signInSchema } from "../dto/auth.dto"
import { AuthService } from "../service/AuthService"

export class AuthController {
  constructor(private authService: AuthService) {}

  async signUp(request: FastifyRequest, reply: FastifyReply) {
    const body = signUpSchema.parse(request.body)
    const result = await this.authService.signUp(body)
    return reply.status(201).send(result)
  }

  async signIn(request: FastifyRequest, reply: FastifyReply) {
    const body = signInSchema.parse(request.body)
    const result = await this.authService.signIn(body)
    return reply.status(200).send(result)
  }
}
