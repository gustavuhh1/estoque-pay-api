import type { FastifyReply, FastifyRequest } from "fastify"
import type {
  SignUpDTO,
  SignInDTO,
  ForgotPasswordDTO,
  ResetPasswordDTO,
} from "../dto/auth.dto"
import { AuthService } from "../service/AuthService"

// O body já chega validado pelo schema declarado na rota — por isso não há
// `schema.parse()` aqui: erro de validação nem alcança o controller.
export class AuthController {
  constructor(private authService: AuthService) {}

  async signUp(
    request: FastifyRequest<{ Body: SignUpDTO }>,
    reply: FastifyReply
  ) {
    const result = await this.authService.signUp(request.body)
    return reply.status(201).send(result)
  }

  async signIn(
    request: FastifyRequest<{ Body: SignInDTO }>,
    reply: FastifyReply
  ) {
    const result = await this.authService.signIn(request.body)
    return reply.status(200).send(result)
  }

  async forgotPassword(
    request: FastifyRequest<{ Body: ForgotPasswordDTO }>,
    reply: FastifyReply
  ) {
    const result = await this.authService.requestResetPassword(
      request.body.email
    )
    return reply.status(200).send(result)
  }

  async resetPassword(
    request: FastifyRequest<{ Body: ResetPasswordDTO }>,
    reply: FastifyReply
  ) {
    const result = await this.authService.resetPassword(
      request.body.token,
      request.body.newPassword
    )
    return reply.status(200).send(result)
  }
}
