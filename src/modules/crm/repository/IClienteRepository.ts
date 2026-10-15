import type { Cliente } from "../../../../generated/prisma/client.js"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CreateClienteParams {
  estabelecimento_id: string
  nome: string
  cpf: string
  telefone?: string | undefined
  data_nascimento?: Date | undefined
  observacao?: string | undefined
}

export interface UpdateClienteParams {
  nome?: string | undefined
  cpf?: string | undefined
  telefone?: string | null | undefined
  data_nascimento?: Date | null | undefined
  observacao?: string | null | undefined
}

export interface ListClientesParams {
  busca?: string | undefined
  page: number
  limit: number
}

export interface ClientesPaginados {
  data: Cliente[]
  total: number
}

export interface IClienteRepository {
  create(data: CreateClienteParams): Promise<Cliente>
  /** RF01.2: escopado por loja, em ordem alfabética, com busca opcional. */
  findManyByEstabelecimento(
    estabelecimentoId: string,
    params: ListClientesParams
  ): Promise<ClientesPaginados>
  /** RF01.3: cliente de outra loja retorna null (indistinguível de inexistente). */
  findByIdAndEstabelecimento(id: string, estabelecimentoId: string): Promise<Cliente | null>
  /** RF01.4: atualização parcial. */
  update(id: string, data: UpdateClienteParams): Promise<Cliente>
  /** O CPF é único por loja; `excludeId` ignora o próprio cliente na edição. */
  existsCpf(estabelecimentoId: string, cpf: string, excludeId?: string): Promise<boolean>
}
