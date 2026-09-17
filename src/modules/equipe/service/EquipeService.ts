import { Prisma, type Role } from "../../../../generated/prisma/client.js"
import { sendEmail } from "@/lib/brevo"
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors"
import type { IAuthRepository } from "@/modules/auth/repository/IAuthRepository"
import type { IEstabelecimentoRepository } from "@/modules/estabelecimento/repository/IEstabelecimentoRepository"
import type { CreateFuncionarioDTO, UpdateFuncionarioDTO } from "../dto/equipe.dto"
import type { IConviteRepository } from "../repository/IConviteRepository"
import type { IEquipeRepository } from "../repository/IEquipeRepository"

/** RN02 (implícita): só o Owner atribui os cargos OWNER/MANAGER — o Gestor administra só o Caixa. */
const CARGOS_ATRIBUIVEIS_POR_MANAGER = ["CASHIER"] as const

export class EquipeService {
  constructor(
    private equipeRepository: IEquipeRepository,
    private conviteRepository: IConviteRepository,
    private authRepository: IAuthRepository,
    private estabelecimentoRepository: IEstabelecimentoRepository
  ) {}

  /** RN04/05: Caixa tem acesso estrito ao PDV — gestão de equipe é só de Gestor/Owner/Admin. */
  private garantirAcesso(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem gerenciar a equipe.",
        "ROLE_CANNOT_MANAGE_EQUIPE"
      )
    }
  }

  /**
   * Gestor só cadastra/edita para o cargo Caixa — nunca promove alguém (nem a
   * si mesmo) a Gestor ou Owner. Só o Owner atribui esses dois cargos.
   */
  private garantirCargoAtribuivel(actingRole: Role, targetRole: Role) {
    if (
      actingRole === "MANAGER" &&
      !CARGOS_ATRIBUIVEIS_POR_MANAGER.includes(targetRole as "CASHIER")
    ) {
      throw new ForbiddenError(
        "Usuários com o cargo Gestor só podem atribuir o cargo Caixa.",
        "ROLE_CANNOT_ASSIGN_ROLE"
      )
    }
  }

  private async garantirNaoUltimoOwner(estabelecimentoId: string) {
    const totalOwners = await this.equipeRepository.countByEstabelecimentoAndRole(
      estabelecimentoId,
      "OWNER"
    )

    if (totalOwners <= 1) {
      throw new ForbiddenError(
        "Não é possível remover o último Owner da loja.",
        "LAST_OWNER_CANNOT_BE_REMOVED"
      )
    }
  }

  /**
   * RF05.1 + RN01 (gestão silenciosa): se o e-mail já tem conta na
   * plataforma, o vínculo é criado na hora, sem nenhum e-mail disparado. Se
   * não tem, fica um convite pendente e um e-mail avisa a pessoa a se
   * cadastrar — o vínculo em si só acontece quando ela completar o cadastro
   * (hook em src/lib/auth.ts consome o convite).
   */
  async cadastrar(
    estabelecimentoId: string,
    actingRole: Role,
    actingUserId: string,
    data: CreateFuncionarioDTO
  ) {
    this.garantirAcesso(actingRole)
    this.garantirCargoAtribuivel(actingRole, data.role)

    const usuario = await this.authRepository.findByEmail(data.email)

    if (!usuario) {
      const estabelecimento = await this.estabelecimentoRepository.findById(estabelecimentoId)

      if (!estabelecimento) {
        throw new NotFoundError("Estabelecimento não encontrado.")
      }

      const convite = await this.conviteRepository.upsertPendente({
        email: data.email,
        estabelecimentoId,
        role: data.role,
        criadoPorId: actingUserId,
      })

      await sendEmail({
        to: data.email,
        subject: `Você foi convidado para a equipe de ${estabelecimento.nome}`,
        html: `<p>Você foi convidado para fazer parte da equipe de <strong>${estabelecimento.nome}</strong> no EstoquePay.</p>
<p>Crie sua conta com este mesmo e-mail (e-mail e senha, ou Google) para começar a usar o sistema — o vínculo com a loja é feito automaticamente assim que o cadastro for concluído.</p>
<p>Se você não esperava este convite, pode ignorar este e-mail.</p>`,
      })

      return { status: "CONVITE_ENVIADO" as const, convite }
    }

    const jaMembro = await this.equipeRepository.findByUserAndEstabelecimento(
      usuario.id,
      estabelecimentoId
    )

    if (jaMembro) {
      throw new ConflictError(
        "Este usuário já faz parte da equipe desta loja.",
        "FUNCIONARIO_JA_VINCULADO"
      )
    }

    try {
      const membro = await this.equipeRepository.create(estabelecimentoId, usuario.id, data.role)

      return { status: "VINCULADO" as const, membro }
    } catch (error) {
      // Corrida: outro request pode ter vinculado o mesmo usuário entre o
      // pré-check e o insert. Mesmo padrão do CNPJ/EAN em outros serviços.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError(
          "Este usuário já faz parte da equipe desta loja.",
          "FUNCIONARIO_JA_VINCULADO"
        )
      }

      throw error
    }
  }

  /** RF05.2 */
  async listar(estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    const [membros, convitesPendentes] = await Promise.all([
      this.equipeRepository.findManyByEstabelecimento(estabelecimentoId),
      this.conviteRepository.findManyPendentesByEstabelecimento(estabelecimentoId),
    ])

    return { membros, convitesPendentes }
  }

  /** RF05.3 + RN02 (Gestor não edita Owner) + trava de cargo atribuível. */
  async editar(
    estabelecimentoId: string,
    actingRole: Role,
    membroId: string,
    data: UpdateFuncionarioDTO
  ) {
    this.garantirAcesso(actingRole)

    const membro = await this.equipeRepository.findByIdAndEstabelecimento(membroId, estabelecimentoId)

    if (!membro) {
      throw new NotFoundError("Funcionário não encontrado nesta loja.")
    }

    if (actingRole === "MANAGER" && membro.role === "OWNER") {
      throw new ForbiddenError(
        "Usuários com o cargo Gestor não podem editar um Owner.",
        "ROLE_CANNOT_EDIT_OWNER"
      )
    }

    this.garantirCargoAtribuivel(actingRole, data.role)

    // Extensão de RN03 além do texto literal da issue (que só cobre exclusão):
    // rebaixar o último Owner deixaria a loja sem dono, o mesmo problema que
    // a trava de exclusão evita — decisão documentada no PR, não pedida
    // explicitamente pela issue.
    if (membro.role === "OWNER" && data.role !== "OWNER") {
      await this.garantirNaoUltimoOwner(estabelecimentoId)
    }

    return this.equipeRepository.update(membroId, data.role)
  }

  /** RF05.4 + RN02 + RN03 (não excluir o último Owner) + RN06 (derruba sessão). */
  async excluir(estabelecimentoId: string, actingRole: Role, membroId: string): Promise<void> {
    this.garantirAcesso(actingRole)

    const membro = await this.equipeRepository.findByIdAndEstabelecimento(membroId, estabelecimentoId)

    if (!membro) {
      throw new NotFoundError("Funcionário não encontrado nesta loja.")
    }

    if (actingRole === "MANAGER" && membro.role === "OWNER") {
      throw new ForbiddenError(
        "Usuários com o cargo Gestor não podem excluir um Owner.",
        "ROLE_CANNOT_EDIT_OWNER"
      )
    }

    if (membro.role === "OWNER") {
      await this.garantirNaoUltimoOwner(estabelecimentoId)
    }

    await this.equipeRepository.delete(membroId)
    // RN06: decisão confirmada com o usuário — só revoga sessão na exclusão
    // (edição de cargo não precisa: o requireTenant já lê o cargo atualizado
    // a cada request, então não há brecha de segurança em deixar a sessão viva).
    await this.equipeRepository.revogarSessoes(membro.userId)
  }
}
