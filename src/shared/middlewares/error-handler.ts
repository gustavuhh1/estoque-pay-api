import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import { APIError } from "better-auth/api"
import { hasZodFastifySchemaValidationErrors } from "@fastify/type-provider-zod"
import { ZodError } from "zod"
import { Prisma } from "../../../generated/prisma/client.js"
import {
  AppError,
  ConflictError,
  EmailAlreadyInUseError,
  UnauthorizedError,
} from "../errors"

/**
 * Códigos do better-auth traduzidos para erros de domínio nossos.
 *
 * O consumidor da API precisa ver o mesmo contrato independente de onde o erro
 * nasceu: o e-mail duplicado detectado pelo nosso pré-check e o detectado pelo
 * better-auth (que responde 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL) devem
 * sair os dois como 409 EMAIL_ALREADY_IN_USE.
 */
const BETTER_AUTH_ERRORS: Record<string, () => AppError> = {
  USER_ALREADY_EXISTS: () => new EmailAlreadyInUseError(),
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: () => new EmailAlreadyInUseError(),
  INVALID_EMAIL_OR_PASSWORD: () => new UnauthorizedError("Credenciais inválidas"),
  USER_NOT_FOUND: () => new UnauthorizedError("Credenciais inválidas"),
}

/** `/endereco/cep` -> `endereco.cep` (formato esperado por formulários). */
function toFieldPath(instancePath: string) {
  return instancePath.replace(/^\//, "").replace(/\//g, ".")
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  /** Ponto único de montagem do envelope de erro da API. */
  const send = (
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) =>
    reply.status(statusCode).send({
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: request.id,
    })

  // Validação vinda do schema declarado na rota (Zod type provider).
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send(400, "VALIDATION_ERROR", "Erro de validação.", {
      issues: error.validation.map((issue) => ({
        field: toFieldPath(issue.instancePath),
        message: issue.message ?? "Valor inválido.",
      })),
    })
  }

  // Validação feita à mão com `schema.parse(...)` fora do ciclo da rota.
  if (error instanceof ZodError) {
    return send(400, "VALIDATION_ERROR", "Erro de validação.", {
      issues: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    })
  }

  // Erros de domínio da aplicação já carregam status, código e contexto certos.
  if (error instanceof AppError) {
    return send(error.statusCode, error.code, error.message, error.details)
  }

  // Erros originados no better-auth (ex: senha incorreta, e-mail duplicado).
  if (error instanceof APIError) {
    const mapped = error.body?.code
      ? BETTER_AUTH_ERRORS[error.body.code]?.()
      : undefined

    if (mapped) {
      return send(mapped.statusCode, mapped.code, mapped.message, mapped.details)
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return send(
        error.statusCode,
        error.body?.code ?? "AUTH_ERROR",
        error.body?.message ?? error.message
      )
    }
    // 5xx do better-auth cai no fallback genérico, sem vazar detalhe interno.
  }

  // Violação de unique no banco: última rede contra a corrida entre o
  // pré-check (findByEmail) e o insert, e contra unique de outros módulos.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const target = error.meta?.["target"]
    const field = Array.isArray(target) ? String(target[0]) : undefined

    if (field?.includes("email")) {
      const conflict = new EmailAlreadyInUseError()
      return send(
        conflict.statusCode,
        conflict.code,
        conflict.message,
        conflict.details
      )
    }

    const conflict = new ConflictError()
    return send(
      conflict.statusCode,
      conflict.code,
      conflict.message,
      field ? { field } : undefined
    )
  }

  // Erros nativos do Fastify que já sabem seu status: JSON malformado,
  // content-type não suportado, payload grande, rota inexistente, rate limit.
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return send(error.statusCode, error.code ?? "BAD_REQUEST", error.message)
  }

  // Desconhecido: nunca expor o motivo, mas sempre logar com o requestId que
  // o cliente recebeu — é o que liga o ticket de suporte ao stack trace.
  // TODO: encaminhar para ferramenta de observabilidade (ex: DataDog/Sentry).
  console.error(`[${request.id}]`, error)

  return send(500, "INTERNAL_SERVER_ERROR", "Erro interno do servidor.")
}
