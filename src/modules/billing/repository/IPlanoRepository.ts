import type { Assinatura } from "../../../../generated/prisma/client.js"

/**
 * Leituras de que o `PlanoService` precisa para decidir o plano e checar os
 * limites. Fica em um repositório próprio (e não nos de produto/equipe)
 * porque a regra de limite é de billing e atravessa os três módulos.
 */
export interface IPlanoRepository {
  /** null = a loja nunca assinou (plano Free). */
  findAssinaturaByEstabelecimento(estabelecimentoId: string): Promise<Assinatura | null>
  /** `ativo = true` e não soft deletado. */
  contarProdutosAtivos(estabelecimentoId: string): Promise<number>
  /** Membros vinculados + convites pendentes (que viram membros ao cadastrar). */
  contarMembrosEConvites(estabelecimentoId: string): Promise<number>
}
