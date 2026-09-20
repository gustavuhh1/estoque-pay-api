import { authRoutes } from "@/modules/auth/routes"
import { estabelecimentoRoutes } from "@/modules/estabelecimento/routes"
import { produtoRoutes } from "@/modules/produto/routes"
import { equipeRoutes } from "@/modules/equipe/routes"
import { estoqueRoutes } from "@/modules/estoque/routes"
import { categoriaRoutes } from "@/modules/categoria/routes"
import { caixaRoutes } from "@/modules/caixa/routes"
import { pagamentoRoutes } from "@/modules/pagamento/routes"
import { vendaRoutes } from "@/modules/venda/routes"
import type { FastifyInstance } from "fastify"

export default async function routes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: "/auth" })
  app.register(estabelecimentoRoutes, { prefix: "/estabelecimento" })
  app.register(produtoRoutes, { prefix: "/produto" })
  app.register(equipeRoutes, { prefix: "/equipe" })
  app.register(categoriaRoutes, { prefix: "/categoria" })
  app.register(estoqueRoutes, { prefix: "/estoque" })
  app.register(caixaRoutes, { prefix: "/caixa" })
  app.register(vendaRoutes, { prefix: "/venda" })
  app.register(pagamentoRoutes(), { prefix: "/pagamento" })
  // app.register(crmRoutes, { prefix: "/crm" })
  // app.register(pdvRoutes, { prefix: "/pdv" })
  // app.register(nfceRoutes, { prefix: "/nfce" })
}
