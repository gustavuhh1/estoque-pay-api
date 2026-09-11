import type { FastifyReply, FastifyRequest } from "fastify"
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../dto/auth.dto"
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

  async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = forgotPasswordSchema.parse(request.body)
    const result = await this.authService.requestResetPassword(body.email)
    return reply.status(200).send(result)
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = resetPasswordSchema.parse(request.body)
    const result = await this.authService.resetPassword(body.token, body.newPassword)
    return reply.status(200).send(result)
  }
}
