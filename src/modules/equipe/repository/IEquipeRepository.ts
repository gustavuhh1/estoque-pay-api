import type { MembroEstabelecimento, Role } from "../../../../generated/prisma/client.js"

export interface FuncionarioComUsuario extends MembroEstabelecimento {
  user: { name: string | null; email: string }
}

export interface IEquipeRepository {
  /** RF05.2: equipe da loja, com nome/e-mail do usuário de cada vínculo. */
  findManyByEstabelecimento(estabelecimentoId: string): Promise<FuncionarioComUsuario[]>
  /** Escopado por loja: vínculo de outra loja retorna null. */
  findByIdAndEstabelecimento(
    id: string,
    estabelecimentoId: string
  ): Promise<FuncionarioComUsuario | null>
  findByUserAndEstabelecimento(
    userId: string,
    estabelecimentoId: string
  ): Promise<MembroEstabelecimento | null>
  /** RF05.1: vínculo direto (usuário já tem conta na plataforma). */
  create(
    estabelecimentoId: string,
    userId: string,
    role: Role
  ): Promise<FuncionarioComUsuario>
  /** RF05.3 */
  update(id: string, role: Role): Promise<FuncionarioComUsuario>
  /** RF05.4 */
  delete(id: string): Promise<void>
  countByEstabelecimentoAndRole(estabelecimentoId: string, role: Role): Promise<number>
  /**
   * RN06: derruba as sessões ativas do usuário removido. É global (todas as
   * lojas dele, não só esta) — o modelo de Session do better-auth não é
   * por-loja. Decisão confirmada com o usuário: só chamado na exclusão, uma
   * troca de cargo não mexe na sessão.
   */
  revogarSessoes(userId: string): Promise<void>
}
