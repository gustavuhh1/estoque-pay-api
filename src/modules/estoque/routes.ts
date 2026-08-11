import type { FastifyInstance } from "fastify"
import { EstoqueController } from "./controllers/estoque.controller.js"

export async function estoqueRoutes(app: FastifyInstance) {
  const estoqueController = new EstoqueController()

  app.get("/status", (req, res) => estoqueController.handle(req, res))
}
