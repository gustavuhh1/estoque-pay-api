import type { FastifyInstance } from "fastify"
import { CrmController } from "./controllers/crm.controller.js"

export async function crmRoutes(app: FastifyInstance) {
  const crmController = new CrmController()

  app.get("/status", (req, res) => crmController.handle(req, res))
}
