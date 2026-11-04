import { FotoGoogleIndisponivelError, NotFoundError } from "@/shared/errors"
import type { UpdatePerfilDTO } from "../dto/perfil.dto"
import { fotoDoIdToken } from "../foto"
import type { IPerfilRepository, Perfil } from "../repository/IPerfilRepository"

export class PerfilService {
  constructor(private perfilRepository: IPerfilRepository) {}

  async buscar(userId: string) {
    return toPerfilResponse(await this.carregar(userId))
  }

  async atualizar(userId: string, dados: UpdatePerfilDTO) {
    await this.perfilRepository.atualizar(userId, { name: dados.nome, image: dados.foto })
    return this.buscar(userId)
  }

  /** Troca a foto atual (mesmo uma enviada) pela do Google: é um pedido explícito do usuário. */
  async usarFotoDoGoogle(userId: string) {
    const foto = fotoDoGoogle(await this.carregar(userId))
    if (!foto) throw new FotoGoogleIndisponivelError()
    await this.perfilRepository.atualizar(userId, { image: foto })
    return this.buscar(userId)
  }

  private async carregar(userId: string) {
    const perfil = await this.perfilRepository.buscar(userId)
    // Sessão válida para um usuário que não existe mais (ex.: apagado pelo seed --reset).
    if (!perfil) throw new NotFoundError("Usuário não encontrado.", "USUARIO_NAO_ENCONTRADO")
    return perfil
  }
}

function fotoDoGoogle(perfil: Perfil): string | null {
  for (const conta of perfil.accounts) {
    if (conta.providerId !== "google") continue
    const foto = fotoDoIdToken(conta.idToken)
    if (foto) return foto
  }
  return null
}

export function toPerfilResponse(perfil: Perfil) {
  const metodos = new Set<"EMAIL" | "GOOGLE">()
  for (const conta of perfil.accounts) {
    if (conta.providerId === "credential") metodos.add("EMAIL")
    if (conta.providerId === "google") metodos.add("GOOGLE")
  }
  return {
    id: perfil.id,
    nome: perfil.name,
    email: perfil.email,
    email_verificado: perfil.emailVerified,
    foto: perfil.image,
    metodos_login: [...metodos],
    foto_google_disponivel: fotoDoGoogle(perfil) !== null,
    criado_em: perfil.createdAt,
    lojas: perfil.estabelecimentos.map((m) => ({
      id: m.estabelecimento.id,
      nome: m.estabelecimento.nome,
      cargo: m.role,
    })),
  }
}
