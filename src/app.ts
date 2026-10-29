import fastify from "fastify"
import cors from "@fastify/cors"
import fastifyRoutes from "@fastify/routes"
import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"

import { errorHandler } from "./shared/middlewares/error-handler"
import routes from "./routes"
import { auth } from "./lib/auth"
import { opcoesDeCors } from "./lib/origens"
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

app.register(cors, opcoesDeCors())

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.register(fastifyRoutes)
// O better-auth fala Web Request/Response. Entregar o request/reply do Fastify
// ao `toNodeHandler` quebra (o reply não tem os métodos do ServerResponse do
// Node), então a ponte é feita aqui, como na integração oficial com Fastify.
app.all("/api/auth/*", async (request, reply) => {
  const url = new URL(request.url, `${request.protocol}://${request.headers.host}`)

  const headers = new Headers()
  for (const [nome, valor] of Object.entries(request.headers)) {
    if (valor === undefined) continue
    headers.append(nome, Array.isArray(valor) ? valor.join(", ") : valor)
  }

  const temCorpo = request.method !== "GET" && request.method !== "HEAD"
  const corpo =
    temCorpo && request.body !== undefined
      ? typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body)
      : null

  const resposta = await auth.handler(
    new Request(url, { method: request.method, headers, body: corpo })
  )

  reply.status(resposta.status)
  resposta.headers.forEach((valor, nome) => {
    // Set-Cookie pode vir repetido e não pode ser unido por vírgula; content-length
    // é recalculado pelo Fastify.
    if (nome !== "set-cookie" && nome !== "content-length") reply.header(nome, valor)
  })
  const cookies = resposta.headers.getSetCookie()
  if (cookies.length > 0) reply.header("set-cookie", cookies)

  return reply.send(resposta.body ? await resposta.text() : null)
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
