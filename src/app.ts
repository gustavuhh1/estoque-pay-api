import fastify from "fastify"
import cors from "@fastify/cors"
import fastifyRoutes from "@fastify/routes"
import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"

import { errorHandler } from "./shared/middlewares/error-handler.js"
import { authRoutes } from "./modules/auth/routes.js"
import { crmRoutes } from "./modules/crm/routes.js"
import { estoqueRoutes } from "./modules/estoque/routes.js"
import { pdvRoutes } from "./modules/pdv/routes.js"
import { nfceRoutes } from "./modules/nfce/routes.js"

export const app = fastify({
  logger: false,
})

app.setErrorHandler(errorHandler)

app.register(cors, {
  origin: true,
})

app.register(fastifyRoutes)

app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Estoque Pay API",
      description: "API para controle de estoque/PDV.",
      version: "0.0.1",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
})

app.register(fastifySwaggerUi, {
  routePrefix: "/documentation",
})

// Registro das rotas dos módulos (Domínios)
app.register(authRoutes, { prefix: "/auth" })
app.register(crmRoutes, { prefix: "/crm" })
app.register(estoqueRoutes, { prefix: "/estoque" })
app.register(pdvRoutes, { prefix: "/pdv" })
app.register(nfceRoutes, { prefix: "/nfce" })

app.get("/", function (request, reply) {
  reply.send({ status: "ok", message: "EstoquePay API running" })
})
