import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type { DadosDoPerfil, IPerfilRepository, Perfil } from "./IPerfilRepository"

export class PerfilPrismaRepository implements IPerfilRepository {
  constructor(private prisma: PrismaClient) {}

  async buscar(userId: string): Promise<Perfil | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        accounts: { select: { providerId: true, idToken: true } },
        estabelecimentos: {
          select: { role: true, estabelecimento: { select: { id: true, nome: true, cnpj: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    })
  }

  async atualizar(userId: string, dados: DadosDoPerfil) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dados.name !== undefined && { name: dados.name }),
        ...(dados.image !== undefined && { image: dados.image }),
      },
    })
  }
}
