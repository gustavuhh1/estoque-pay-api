import fastify from "fastify"
import cors from "@fastify/cors"
import fastifyRoutes from "@fastify/routes"
import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"

export const app = fastify({
  logger: true,
})

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

app.get("/", function (request, reply) {
  reply.send({ hello: "world" })
})
