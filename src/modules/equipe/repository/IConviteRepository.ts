import type { ConviteFuncionario, Role } from "../../../../generated/prisma/client.js"

export interface UpsertConviteParams {
  email: string
  estabelecimentoId: string
  role: Role
  criadoPorId: string
}

export interface IConviteRepository {
  /**
   * RF05.1: cria o convite pendente, ou atualiza o cargo/quem convidou se já
   * existir um pendente para este e-mail nesta loja (reenvio simplesmente
   * substitui em vez de acumular duplicado — a unique key é [email, estabelecimentoId]).
   */
  upsertPendente(data: UpsertConviteParams): Promise<ConviteFuncionario>
  findManyPendentesByEstabelecimento(estabelecimentoId: string): Promise<ConviteFuncionario[]>
}
