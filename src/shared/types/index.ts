/**
 * Tipagens globais da aplicação.
 */

/**
 * Usuário resolvido pelo requireAuth a partir da sessão do better-auth.
 *
 * Sem `role` de propósito: o cargo é do vínculo, não da pessoa
 * (MembroEstabelecimento.role), então a mesma conta pode ser OWNER numa loja e
 * CASHIER em outra. Quem valida cargo é um guard de loja, com a loja em mãos.
 */
export interface AuthenticatedUser {
  id: string
  email: string
}

export interface UserPayload {
  id: string
  email: string
  role: "ADMIN" | "OWNER" | "GESTOR" | "CAIXA"
}
