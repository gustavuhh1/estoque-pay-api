import type { Cupom, CupomUso, TipoDescontoCupom } from "../../../../generated/prisma/client.js"
import type { CupomComResumo } from "../dto/cupom.dto"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CreateCupomParams {
  estabelecimento_id: string
  cliente_id?: string | undefined
  codigo: string
  tipo_desconto: TipoDescontoCupom
  valor_desconto: number
  expira_em?: Date | undefined
}

export type CupomUsoComCliente = CupomUso & { cliente: { nome: string } | null }

export interface ICupomRepository {
  create(data: CreateCupomParams): Promise<Cupom>
  /** RF02.3: cupons da loja, mais recentes primeiro, filtráveis por cliente, com o resumo de usos. */
  findManyByEstabelecimento(
    estabelecimentoId: string,
    filtros: { cliente_id?: string | undefined }
  ): Promise<CupomComResumo[]>
  findByIdAndEstabelecimento(id: string, estabelecimentoId: string): Promise<Cupom | null>
  /** O código é único por loja: é por ele que o caixa resgata no balcão. */
  findByCodigo(estabelecimentoId: string, codigo: string): Promise<Cupom | null>
  existsCodigo(estabelecimentoId: string, codigo: string): Promise<boolean>
  /** Trava "1 uso por CPF" checada antes da venda (a definitiva é o unique de cupom_usos). */
  existsUso(cupomId: string, cpf: string): Promise<boolean>
  desativar(id: string): Promise<CupomComResumo>
  findUsos(cupomId: string): Promise<CupomUsoComCliente[]>
}
