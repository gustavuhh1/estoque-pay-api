import { Prisma } from "../../../../generated/prisma/client.js"
import { CnpjAlreadyInUseError } from "@/shared/errors"
import type { CreateEstabelecimentoDTO } from "../dto/estabelecimento.dto"
import type { IEstabelecimentoRepository } from "../repository/IEstabelecimentoRepository"

export type CreateEstabelecimentoCommand = CreateEstabelecimentoDTO & {
  ownerId: string
}

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
}
