import type { Cliente, Prisma } from "../../../../generated/prisma/client.js"
import type { VendaComItens } from "@/modules/venda/dto/venda.dto"
import type { ProdutoFavorito } from "../dto/cliente.dto"

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

export interface ComprasPaginadas {
  data: VendaComItens[]
  total: number
}

/** Agregado das vendas PAGAS do cliente. Valor em Decimal para não perder centavo. */
export interface ResumoDeCompras {
  total_compras: number
  valor_total_gasto: Prisma.Decimal
  primeira_compra_em: Date | null
  ultima_compra_em: Date | null
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
  /**
   * RF02.1: as vendas vinculadas ao cliente (de qualquer status), da mais
   * recente para a mais antiga. O vínculo em si é gravado pelo pagamento
   * (`Venda.cliente_id`), não por aqui.
   */
  findCompras(
    clienteId: string,
    estabelecimentoId: string,
    params: { page: number; limit: number }
  ): Promise<ComprasPaginadas>
  /** RF02.2: só vendas PAGAS — cancelada e Pix pendente não são consumo. */
  resumoDeCompras(clienteId: string, estabelecimentoId: string): Promise<ResumoDeCompras>
  /**
   * RF02.2: os produtos que mais aparecem nas vendas PAGAS do cliente,
   * agregados no banco (`groupBy`), não em memória.
   */
  produtosFavoritos(
    clienteId: string,
    estabelecimentoId: string,
    top: number
  ): Promise<ProdutoFavorito[]>
}
