import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import z, { ZodError } from "zod"

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Erro de validação.",
      issues: z.treeifyError(error),
    })
  }

  if (process.env.NODE_ENV !== "production") {
    console.error(error)
  } else {
    // Log para ferramenta externa de observabilidade (ex: DataDog/Sentry)
  }

  return reply.status(500).send({
    message: "Erro interno do servidor.",
  })
}
