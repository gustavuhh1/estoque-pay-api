import type { FastifyInstance } from "fastify"
import { AuthController } from "./controller/AuthController"
import { AuthService } from "./service/AuthService"
import { AuthPrismaRepository } from "./repository/AuthPrismaRepository"
import { prisma } from "@/lib/prisma"

export async function authRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositório (Infrastructure)
  const authRepository = new AuthPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const authService = new AuthService(authRepository)

  // 3. Instanciar Controller (Presentation)
  const authController = new AuthController(authService)

  // 4. Registrar Rotas
  app.post("/register", async (req, res) => authController.signUp(req, res))
  app.post("/login", async (req, res) => authController.signIn(req, res))
}
