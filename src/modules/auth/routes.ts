import type { FastifyInstance } from "fastify"
import { AuthController } from "./controllers/auth.controller.js"

export async function authRoutes(app: FastifyInstance) {
  const authController = new AuthController()

  app.get("/status", (req, res) => authController.handle(req, res))
}
