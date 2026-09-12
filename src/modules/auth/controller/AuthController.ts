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
    const { headers, ...result } = await this.authService.signIn(request.body)

    // O cookie de sessão nasce dentro do better-auth; é aqui que ele é
    // repassado para a resposta HTTP, senão o cliente sai do login sem sessão.
    for (const cookie of headers.getSetCookie()) {
      reply.header("set-cookie", cookie)
    }

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
