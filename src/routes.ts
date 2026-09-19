import { authRoutes } from "@/modules/auth/routes"
import { estabelecimentoRoutes } from "@/modules/estabelecimento/routes"
import { produtoRoutes } from "@/modules/produto/routes"
import { equipeRoutes } from "@/modules/equipe/routes"
import { categoriaRoutes } from "@/modules/categoria/routes"
import type { FastifyInstance } from "fastify"

export default async function routes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: "/auth" })
  app.register(estabelecimentoRoutes, { prefix: "/estabelecimento" })
  app.register(produtoRoutes, { prefix: "/produto" })
  app.register(equipeRoutes, { prefix: "/equipe" })
  app.register(categoriaRoutes, { prefix: "/categoria" })
  // app.register(crmRoutes, { prefix: "/crm" })
  // app.register(estoqueRoutes, { prefix: "/estoque" })
  // app.register(pdvRoutes, { prefix: "/pdv" })
  // app.register(nfceRoutes, { prefix: "/nfce" })
}
