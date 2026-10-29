import type { Assinatura } from "../../../../generated/prisma/client.js"
import type { IPlanoRepository } from "./IPlanoRepository"

/** Dublê para os testes unitários: o teste dita assinatura e contagens. */
export class InMemoryPlanoRepository implements IPlanoRepository {
  public assinaturas = new Map<string, Assinatura>()
  public produtosAtivos = new Map<string, number>()
  public membrosEConvites = new Map<string, number>()

  async findAssinaturaByEstabelecimento(estabelecimentoId: string) {
    return this.assinaturas.get(estabelecimentoId) ?? null
  }

  async contarProdutosAtivos(estabelecimentoId: string) {
    return this.produtosAtivos.get(estabelecimentoId) ?? 0
  }

  async contarMembrosEConvites(estabelecimentoId: string) {
    return this.membrosEConvites.get(estabelecimentoId) ?? 0
  }
}
