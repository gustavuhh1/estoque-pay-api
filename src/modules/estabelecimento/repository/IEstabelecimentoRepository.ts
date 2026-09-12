import type {
  Estabelecimento,
  MembroEstabelecimento,
} from "../../../../generated/prisma/client.js"

/**
 * `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig:
 * sem ele o DTO (onde `ie` é opcional) não é atribuível a este parâmetro.
 */
export interface CreateWithOwnerParams {
  nome: string
  cnpj: string
  ie?: string | undefined
  ownerId: string
}

export interface CreateWithOwnerResult {
  estabelecimento: Estabelecimento
  membro: MembroEstabelecimento
}

export interface IEstabelecimentoRepository {
  findByCnpj(cnpj: string): Promise<Estabelecimento | null>
  /**
   * Cria a loja e o vínculo do dono numa única transação (RF02.1 + RF02.2):
   * loja sem dono é lixo no banco e ninguém consegue administrá-la.
   */
  createWithOwner(params: CreateWithOwnerParams): Promise<CreateWithOwnerResult>
}
