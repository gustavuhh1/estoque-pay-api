import type { FastifyReply, FastifyRequest } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "@/lib/auth"
import { UnauthorizedError } from "@/shared/errors"
import type { AuthenticatedUser } from "@/shared/types"

/**
 * A augmentation mora aqui (e não num .d.ts solto) porque o tsconfig tem
 * `"types": []` e nenhum `include`: um arquivo de declaração que ninguém importa
 * não seria carregado. Toda rota protegida importa este módulo.
 */
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

/**
 * preHandler que exige sessão válida do better-auth e popula `request.user`.
 *
 * Lança em vez de responder: o app.setErrorHandler já monta o envelope de erro
 * padrão da API, então o 401 sai com o mesmo formato de todo o resto.
 *
 * Atenção ao ciclo do Fastify: o preHandler roda DEPOIS da validação de body,
 * então um request sem sessão e com body inválido responde 400, não 401.
 */
export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // fromNodeHeaders trata headers com valor em array, que quebrariam um
  // `new Headers(request.headers)` feito na mão.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })

  if (!session?.user) {
    throw new UnauthorizedError("Autenticação necessária.")
  }

  request.user = {
    id: session.user.id,
    email: session.user.email,
  }
}
