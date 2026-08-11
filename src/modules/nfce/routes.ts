import type { FastifyInstance } from "fastify"
import { NfceController } from "./controllers/nfce.controller.js"

export async function nfceRoutes(app: FastifyInstance) {
  const nfceController = new NfceController()

  app.get("/status", (req, res) => nfceController.handle(req, res))
}
