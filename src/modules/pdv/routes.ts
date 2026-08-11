import type { FastifyInstance } from "fastify"
import { PdvController } from "./controllers/pdv.controller.js"

export async function pdvRoutes(app: FastifyInstance) {
  const pdvController = new PdvController()

  app.get("/status", (req, res) => pdvController.handle(req, res))
}
