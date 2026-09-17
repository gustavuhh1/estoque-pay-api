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
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from "@fastify/type-provider-zod"

export const app = fastify({
  logger: false,
})

app.setErrorHandler(errorHandler)

// Rota inexistente não passa pelo errorHandler: sem isto o 404 sairia no
// formato padrão do Fastify, quebrando o contrato de erro da API.
app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    code: "ROUTE_NOT_FOUND",
    message: `Rota ${request.method} ${request.url} não encontrada.`,
    requestId: request.id,
  })
})

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
        // A sessão do better-auth viaja em cookie httpOnly; não há plugin
        // bearer habilitado, então declarar bearerAuth aqui seria mentira.
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
    },
    security: [{ cookieAuth: [] }],
  },
  // Converte os schemas Zod das rotas em OpenAPI (sem isso o /apidocs não
  // mostra body nem as respostas de erro documentadas).
  transform: jsonSchemaTransform,
})

app.register(fastifySwaggerUi, {
  routePrefix: "/apidocs",
})

// Registro das rotas centralizadas
app.register(routes)

app.get("/", function (request, reply) {
  reply.send({ status: "ok", message: "EstoquePay API running" })
})
