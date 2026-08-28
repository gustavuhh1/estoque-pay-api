import { authRoutes } from "@/modules/auth/routes"
import type { FastifyInstance } from "fastify"

export default async function routes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: "/auth" })
  // app.register(crmRoutes, { prefix: "/crm" })
  // app.register(estabelecimentoRoutes, { prefix: "/estabelecimento" })
  // app.register(estoqueRoutes, { prefix: "/estoque" })
  // app.register(pdvRoutes, { prefix: "/pdv" })
  // app.register(nfceRoutes, { prefix: "/nfce" })
}
