import type { FastifyReply, FastifyRequest } from "fastify"
import { prisma } from "@/lib/prisma"
import { BadRequestError, ForbiddenError, UnauthorizedError } from "@/shared/errors"
import type { Role } from "../../../generated/prisma/client.js"

/** Ver o comentário equivalente em require-auth.ts sobre onde a augmentation mora. */
declare module "fastify" {
  interface FastifyRequest {
    membro?: { estabelecimentoId: string; role: Role }
  }
}

const TENANT_HEADER = "x-estabelecimento-id"

/**
 * preHandler que resolve a "loja ativa" a partir do header `x-estabelecimento-id`
 * e popula `request.membro`. Precisa rodar depois do requireAuth (usa
 * `request.user`), sempre como `preHandler: [requireAuth, requireTenant]`.
 *
 * Só valida o VÍNCULO (o usuário pertence a essa loja?) — regras de cargo por
 * campo (ex: Gestor não edita CNPJ) ficam no Service, que é quem sabe o que
 * cada rota está tentando fazer.
 */
export async function requireTenant(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    throw new UnauthorizedError("Autenticação necessária.")
  }

  const estabelecimentoId = request.headers[TENANT_HEADER]

  // Array acontece se o cliente mandar o header duas vezes; não é um caso
  // válido, então trata igual a "ausente".
  if (!estabelecimentoId || Array.isArray(estabelecimentoId)) {
    throw new BadRequestError(
      `Header ${TENANT_HEADER} é obrigatório.`,
      "TENANT_HEADER_REQUIRED"
    )
  }

  const membro = await prisma.membroEstabelecimento.findUnique({
    where: {
      userId_estabelecimentoId: {
        userId: request.user.id,
        estabelecimentoId,
      },
    },
  })

  if (!membro) {
    throw new ForbiddenError(
      "Você não tem vínculo com este estabelecimento.",
      "TENANT_ACCESS_DENIED"
    )
  }

  request.membro = { estabelecimentoId, role: membro.role }
}
