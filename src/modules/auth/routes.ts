import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { AuthController } from "./controller/AuthController"
import { AuthService } from "./service/AuthService"
import { AuthPrismaRepository } from "./repository/AuthPrismaRepository"
import { prisma } from "@/lib/prisma"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signUpResponseSchema,
  signInResponseSchema,
  passwordResetResponseSchema,
} from "./dto/auth.dto"

export async function authRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositório (Infrastructure)
  const authRepository = new AuthPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const authService = new AuthService(authRepository)

  // 3. Instanciar Controller (Presentation)
  const authController = new AuthController(authService)

  // 4. Registrar Rotas
  // O schema valida o body antes do handler e documenta as respostas de erro
  // no /apidocs — é o contrato que o consumidor da API programa contra.
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Cria uma conta com e-mail e senha",
        body: signUpSchema,
        response: {
          201: signUpResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          409: errorResponseSchema.describe("E-mail já cadastrado (code: EMAIL_ALREADY_IN_USE)"),
        },
      },
    },
    async (req, res) => authController.signUp(req, res)
  )

  route.post(
    "/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Autentica com e-mail e senha",
        body: signInSchema,
        response: {
          200: signInResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Credenciais inválidas (code: UNAUTHORIZED)"),
        },
      },
    },
    async (req, res) => authController.signIn(req, res)
  )

  route.post(
    "/forgot-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Envia o e-mail de redefinição de senha",
        body: forgotPasswordSchema,
        response: {
          200: passwordResetResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Credenciais inválidas (code: UNAUTHORIZED)"),
        },
      },
    },
    async (req, res) => authController.forgotPassword(req, res)
  )

  route.post(
    "/reset-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Redefine a senha a partir do token recebido por e-mail",
        body: resetPasswordSchema,
        response: {
          200: passwordResetResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
        },
      },
    },
    async (req, res) => authController.resetPassword(req, res)
  )
}
