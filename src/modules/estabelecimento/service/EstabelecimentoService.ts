import { Prisma, type Role } from "../../../../generated/prisma/client.js"
import { CnpjAlreadyInUseError, ForbiddenError, NotFoundError } from "@/shared/errors"
import type {
  CreateEstabelecimentoDTO,
  UpdateEstabelecimentoDTO,
} from "../dto/estabelecimento.dto"
import type { IEstabelecimentoRepository } from "../repository/IEstabelecimentoRepository"

export type CreateEstabelecimentoCommand = CreateEstabelecimentoDTO & {
  ownerId: string
}

/**
 * RN04/05: CNPJ e Certificado A1 são dados críticos/fiscais — só o OWNER pode
 * alterá-los. O Gestor administra o dia a dia da loja, mas não isso.
 */
const CAMPOS_CRITICOS = [
  "cnpj",
  "certificado_a1",
  "certificado_a1_senha",
] as const satisfies readonly (keyof UpdateEstabelecimentoDTO)[]

export class EstabelecimentoService {
  constructor(private estabelecimentoRepository: IEstabelecimentoRepository) {}

  /**
   * RF02.1 + RF02.2: cria a loja e vincula quem criou como OWNER.
   * O repositório faz os dois inserts na mesma transação.
   */
  async create(data: CreateEstabelecimentoCommand) {
    // Caminho rápido: evita abrir transação para um CNPJ já conhecido.
    const existente = await this.estabelecimentoRepository.findByCnpj(data.cnpj)

    if (existente) {
      throw new CnpjAlreadyInUseError()
    }

    try {
      const { estabelecimento, membro } =
        await this.estabelecimentoRepository.createWithOwner(data)

      return {
        message: "Estabelecimento criado com sucesso",
        estabelecimento,
        membro,
      }
    } catch (error) {
      // Corrida: entre o pré-check e o insert outro request pode ter criado o
      // mesmo CNPJ. O unique do banco é quem decide, e o 409 sai igual nos dois
      // caminhos — mesmo padrão do e-mail duplicado em AuthService.signUp.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CnpjAlreadyInUseError()
      }

      throw error
    }
  }

  /** RF03.1: lojas onde o usuário tem vínculo, cada uma com o cargo dele. */
  async listByUser(userId: string) {
    return this.estabelecimentoRepository.findManyByUserId(userId)
  }

  /**
   * RF03.2 + RF04.1 (leitura): o vínculo já foi validado pelo requireTenant
   * — chegar até aqui já prova que o usuário pode ver esta loja.
   */
  async getAtivo(estabelecimentoId: string, role: Role) {
    const estabelecimento =
      await this.estabelecimentoRepository.findById(estabelecimentoId)

    if (!estabelecimento) {
      // Não deveria acontecer (o vínculo tem FK pra loja), mas não custa não
      // estourar um erro genérico se acontecer.
      throw new NotFoundError("Estabelecimento não encontrado.")
    }

    return { ...estabelecimento, role }
  }

  /** RF04.1 (escrita) / RF04.2: atualiza os dados cadastrais da loja ativa. */
  async updateAtivo(
    estabelecimentoId: string,
    role: Role,
    data: UpdateEstabelecimentoDTO
  ) {
    // RN04/05: Caixa tem acesso estrito ao PDV — nem os campos não-críticos.
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem editar os dados da loja.",
        "ROLE_CANNOT_EDIT_STORE"
      )
    }

    // RN04/05: Gestor administra a operação, mas não os dados críticos/fiscais.
    if (role === "MANAGER") {
      const tentouCampoCritico = CAMPOS_CRITICOS.some((campo) => campo in data)

      if (tentouCampoCritico) {
        throw new ForbiddenError(
          "Usuários com o cargo Gestor não podem editar dados críticos da loja (CNPJ, Certificado A1).",
          "CRITICAL_FIELD_FORBIDDEN"
        )
      }
    }

    // OWNER (e ADMIN vinculado à loja) têm acesso total: nenhum bloqueio acima.

    if (data.cnpj) {
      const existente = await this.estabelecimentoRepository.findByCnpj(
        data.cnpj
      )

      if (existente && existente.id !== estabelecimentoId) {
        throw new CnpjAlreadyInUseError()
      }
    }

    try {
      return await this.estabelecimentoRepository.update(
        estabelecimentoId,
        data
      )
    } catch (error) {
      // Mesma corrida do create: CNPJ pode ter sido tomado entre o pré-check
      // e o update.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CnpjAlreadyInUseError()
      }

      throw error
    }
  }
}
