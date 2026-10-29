import type { Cupom } from "../../../../generated/prisma/client.js"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CreateCupomParams {
  estabelecimento_id: string
  cliente_id?: string | undefined
  codigo: string
  valor_desconto: number
  expira_em?: Date | undefined
}

export interface ICupomRepository {
  create(data: CreateCupomParams): Promise<Cupom>
  /** RF02.3: cupons da loja, mais recentes primeiro, filtráveis por cliente. */
  findManyByEstabelecimento(
    estabelecimentoId: string,
    filtros: { cliente_id?: string | undefined }
  ): Promise<Cupom[]>
  /** O código é único por loja: é por ele que o caixa resgata no balcão. */
  findByCodigo(estabelecimentoId: string, codigo: string): Promise<Cupom | null>
  existsCodigo(estabelecimentoId: string, codigo: string): Promise<boolean>
}
