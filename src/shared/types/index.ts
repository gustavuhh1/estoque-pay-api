/**
 * Tipagens globais da aplicação.
 */
export interface UserPayload {
  id: string
  email: string
  role: "ADMIN" | "OWNER" | "GESTOR" | "CAIXA"
}
