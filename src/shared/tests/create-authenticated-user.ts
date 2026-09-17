import { randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * Cria um usuário e devolve o header `Cookie` com a sessão dele, pronto para o
 * `app.inject` das rotas protegidas.
 *
 * Chama o better-auth direto (em vez de injetar POST /auth/login) para não
 * depender da checagem de origem do handler montado em /api/auth/*, que o
 * `app.inject` não consegue satisfazer (ele sintetiza host "localhost:80").
 *
 * Precisa ser chamado DENTRO de cada `it`: o beforeEach do vitest.setup.ts
 * trunca a tabela de usuários entre os testes.
 */
export async function createAuthenticatedUser(
  overrides: { email?: string; name?: string } = {}
) {
  const email = overrides.email ?? `owner-${randomUUID()}@email.com`
  const password = "password123"

  await auth.api.signUpEmail({
    body: { email, password, name: overrides.name ?? "Dono de Teste" },
  })

  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  })

  const cookie = toCookieHeader(headers)
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })

  return { user, cookie, email, password }
}

/** Converte os `Set-Cookie` da resposta no header `Cookie` de um request. */
export function toCookieHeader(headers: Headers): string {
  const setCookies = headers.getSetCookie
    ? headers.getSetCookie()
    : [headers.get("set-cookie") ?? ""]

  return setCookies
    .filter(Boolean)
    // Descarta os atributos (Path, HttpOnly, SameSite...) e mantém só nome=valor.
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}
