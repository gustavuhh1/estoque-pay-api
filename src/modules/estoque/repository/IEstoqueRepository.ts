import type {
  MotivoMovimentacao,
  Produto,
  TipoMovimentacao,
} from "../../../../generated/prisma/client.js"
import type { MovimentacaoComRelacoes } from "../dto/estoque.dto"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface RegistrarMovimentacaoParams {
  estabelecimento_id: string
  produto_id: string
  usuario_id: string
  quantidade: number
  tipo: TipoMovimentacao
  motivo: MotivoMovimentacao
  observacao?: string | undefined
}

export interface ListMovimentacoesParams {
  produto_id?: string | undefined
  page: number
  limit: number
}

export interface ListMovimentacoesResult {
  data: MovimentacaoComRelacoes[]
  total: number
}

export interface IEstoqueRepository {
  /**
   * RF12.1/RF13.2 + RN05: aplica o delta no saldo do produto e grava a linha de
   * auditoria na MESMA transação — nunca uma sem a outra. Lança
   * EstoqueInsuficienteError (revertendo tudo) se a saída zerar abaixo de 0.
   */
  registrarMovimentacao(
    params: RegistrarMovimentacaoParams
  ): Promise<MovimentacaoComRelacoes>
  /** RF15.4: histórico paginado da loja, opcionalmente filtrado por produto. */
  findManyByEstabelecimento(
    estabelecimentoId: string,
    params: ListMovimentacoesParams
  ): Promise<ListMovimentacoesResult>
  /** RF16.1/RF17.2: produtos ativos e não deletados com saldo <= mínimo. */
  findProdutosComEstoqueBaixo(estabelecimentoId: string): Promise<Produto[]>
}
