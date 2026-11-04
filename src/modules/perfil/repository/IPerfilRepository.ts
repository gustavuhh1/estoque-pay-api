import type { Role } from "../../../../generated/prisma/client.js"

export interface Perfil {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: Date
  accounts: { providerId: string; idToken: string | null }[]
  estabelecimentos: { role: Role; estabelecimento: { id: string; nome: string } }[]
}

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface DadosDoPerfil {
  name?: string | undefined
  image?: string | null | undefined
}

export interface IPerfilRepository {
  buscar(userId: string): Promise<Perfil | null>
  atualizar(userId: string, dados: DadosDoPerfil): Promise<void>
}
