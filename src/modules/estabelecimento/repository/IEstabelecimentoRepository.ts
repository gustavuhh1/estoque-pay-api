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

/** Uma loja onde o usuário tem vínculo, com o cargo dele nela (RF03.1). */
export interface EstabelecimentoComMembro {
  estabelecimento: Estabelecimento
  role: MembroEstabelecimento["role"]
}

/**
 * Atualização parcial dos dados cadastrais (RF04.2). `emite_nfce` fica de
 * fora de propósito: ligar o switch fiscal depende de um pre-check próprio
 * (ver comentário em estabelecimento.dto.ts) que não passa por aqui.
 */
export interface UpdateEstabelecimentoParams {
  nome?: string | undefined
  cnpj?: string | undefined
  ie?: string | null | undefined
  certificado_a1?: string | null | undefined
  certificado_a1_senha?: string | null | undefined
}

export interface IEstabelecimentoRepository {
  findByCnpj(cnpj: string): Promise<Estabelecimento | null>
  /**
   * Cria a loja e o vínculo do dono numa única transação (RF02.1 + RF02.2):
   * loja sem dono é lixo no banco e ninguém consegue administrá-la.
   */
  createWithOwner(params: CreateWithOwnerParams): Promise<CreateWithOwnerResult>
  /** RF03.1: lojas onde o usuário tem vínculo, cada uma com o cargo dele. */
  findManyByUserId(userId: string): Promise<EstabelecimentoComMembro[]>
  /** RF03.2 / RF04.1: dados completos da loja ativa. */
  findById(id: string): Promise<Estabelecimento | null>
  /** RF04.2: atualização parcial dos dados cadastrais. */
  update(
    id: string,
    data: UpdateEstabelecimentoParams
  ): Promise<Estabelecimento>
}
