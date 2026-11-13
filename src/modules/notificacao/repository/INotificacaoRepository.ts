import type {
  Notificacao,
  Prisma,
  TipoMedida,
  TipoNotificacao,
} from "../../../../generated/prisma/client.js"

/** `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig. */
export interface CriarNotificacaoParams {
  estabelecimento_id: string
  tipo: TipoNotificacao
  titulo: string
  mensagem: string
  link?: string | null | undefined
  /** Deduplicação: não cria se já houver uma NÃO LIDA com a mesma chave na loja. */
  chave?: string | null | undefined
}

/** O mínimo do produto que os gatilhos de estoque precisam ler. */
export interface ProdutoEstoque {
  id: string
  nome: string
  tipo_medida: TipoMedida
  quantidade_atual: Prisma.Decimal
  quantidade_minima: Prisma.Decimal
  deletado_em: Date | null
}

export interface INotificacaoRepository {
  /**
   * Grava a notificação. Devolve `false` (sem lançar) quando a chave já tem
   * uma não lida na loja — o índice parcial `notificacoes_chave_nao_lida` barra.
   */
  criar(params: CriarNotificacaoParams): Promise<boolean>
  /** Mais recentes primeiro. */
  listar(estabelecimentoId: string, limite: number): Promise<Notificacao[]>
  contarNaoLidas(estabelecimentoId: string): Promise<number>
  /** Marca como lida (idempotente). `null` se não existe NESTA loja. */
  marcarLida(id: string, estabelecimentoId: string): Promise<Notificacao | null>
  /** Devolve quantas mudaram. */
  marcarTodasLidas(estabelecimentoId: string): Promise<number>
  buscarProdutos(estabelecimentoId: string, ids: string[]): Promise<ProdutoEstoque[]>
  /** Soma das vendas em DINHEIRO e PAGAS do turno: o que deveria estar na gaveta além do fundo. */
  somarVendasEmDinheiroDoTurno(turnoId: string): Promise<Prisma.Decimal>
}
