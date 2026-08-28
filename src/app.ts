import fastify from "fastify"
import cors from "@fastify/cors"
import fastifyRoutes from "@fastify/routes"
import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"
import { toNodeHandler } from "better-auth/node"

import { errorHandler } from "./shared/middlewares/error-handler"
import routes from "./routes"
import { auth } from "./lib/auth"
import {
  serializerCompiler,
  validatorCompiler
} from "@fastify/type-provider-zod"

export const app = fastify({
  logger: false,
})

app.setErrorHandler(errorHandler)

app.register(cors, {
  origin: true,
})

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.register(fastifyRoutes)
app.all("/api/auth/*", async (request, reply) => {
  const nodeHandler = toNodeHandler(auth)
  await nodeHandler(request as any, reply as any)
})

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
  routePrefix: "/apidocs",
})

// Registro das rotas centralizadas
app.register(routes)

app.get("/", function (request, reply) {
  reply.send({ status: "ok", message: "EstoquePay API running" })
})
