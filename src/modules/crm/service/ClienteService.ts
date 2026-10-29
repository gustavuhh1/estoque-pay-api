import { Prisma, type Cliente } from "../../../../generated/prisma/client.js"
import { ClienteCpfAlreadyInUseError, NotFoundError } from "@/shared/errors"
import type { PlanoService } from "@/modules/billing/service/PlanoService"
import type {
  CreateClienteDTO,
  EstatisticasCliente,
  ListClientesQuery,
  ListComprasQuery,
  UpdateClienteDTO,
} from "../dto/cliente.dto"
import type {
  ClientesPaginados,
  ComprasPaginadas,
  IClienteRepository,
} from "../repository/IClienteRepository"

/**
 * RF01.1 a RF01.4 — issue #57.
 *
 * Sem `garantirAcesso` por cargo: quem identifica o cliente no balcão é o
 * Caixa, então cadastrar, buscar e corrigir dados de cliente é trabalho de
 * qualquer membro da loja. O vínculo com a loja já foi garantido pelo
 * requireTenant.
 */
export class ClienteService {
  constructor(
    private clienteRepository: IClienteRepository,
    private planoService: PlanoService
  ) {}

  /** RF01.1 */
  async create(estabelecimentoId: string, data: CreateClienteDTO): Promise<Cliente> {
    // RN01 (Fase 5): no Free o cliente só tem CPF e Nome.
    await this.planoService.garantirCamposDoCrm(estabelecimentoId, data)

    if (await this.clienteRepository.existsCpf(estabelecimentoId, data.cpf)) {
      throw new ClienteCpfAlreadyInUseError()
    }

    try {
      return await this.clienteRepository.create({
        ...data,
        estabelecimento_id: estabelecimentoId,
      })
    } catch (error) {
      // Corrida: outro request pode ter cadastrado o mesmo CPF entre o
      // pré-check e o insert. O unique (estabelecimento_id, cpf) decide.
      // Mesmo padrão do ean_gtin em ProdutoService.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ClienteCpfAlreadyInUseError()
      }

      throw error
    }
  }

  /** RF01.2 */
  async list(
    estabelecimentoId: string,
    query: ListClientesQuery
  ): Promise<ClientesPaginados & { page: number; limit: number }> {
    const { data, total } = await this.clienteRepository.findManyByEstabelecimento(
      estabelecimentoId,
      query
    )

    return { data, total, page: query.page, limit: query.limit }
  }

  /** RF01.3 */
  async findById(id: string, estabelecimentoId: string): Promise<Cliente> {
    const cliente = await this.clienteRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    // Cliente de outra loja é indistinguível de inexistente, de propósito.
    if (!cliente) {
      throw new NotFoundError("Cliente não encontrado nesta loja.", "CLIENTE_NAO_ENCONTRADO")
    }

    return cliente
  }

  /** RF01.4 */
  async update(
    id: string,
    estabelecimentoId: string,
    data: UpdateClienteDTO
  ): Promise<Cliente> {
    await this.findById(id, estabelecimentoId)

    // Limpar um campo (null) sempre passa: quem foi rebaixado ainda pode apagar
    // o que tinha. Só PREENCHER é bloqueado no Free.
    await this.planoService.garantirCamposDoCrm(estabelecimentoId, data)

    if (
      data.cpf &&
      (await this.clienteRepository.existsCpf(estabelecimentoId, data.cpf, id))
    ) {
      throw new ClienteCpfAlreadyInUseError()
    }

    try {
      return await this.clienteRepository.update(id, data)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ClienteCpfAlreadyInUseError()
      }

      throw error
    }
  }

  /**
   * RF02.1 — issue #58. O vínculo venda↔cliente é gravado pelo pagamento
   * (`cliente_id` no POST /pagamento); aqui só se lê o que ficou indexado.
   */
  async listarCompras(
    id: string,
    estabelecimentoId: string,
    query: ListComprasQuery
  ): Promise<ComprasPaginadas & { page: number; limit: number }> {
    await this.findById(id, estabelecimentoId)

    const { data, total } = await this.clienteRepository.findCompras(
      id,
      estabelecimentoId,
      query
    )

    return { data, total, page: query.page, limit: query.limit }
  }

  /**
   * RF02.2 — issue #58. Só vendas PAGAS entram: venda cancelada foi estornada
   * e Pix pendente nunca foi pago, nenhum dos dois é consumo do cliente.
   */
  async estatisticas(
    id: string,
    estabelecimentoId: string,
    top: number
  ): Promise<EstatisticasCliente> {
    await this.findById(id, estabelecimentoId)

    const [resumo, produtosFavoritos] = await Promise.all([
      this.clienteRepository.resumoDeCompras(id, estabelecimentoId),
      this.clienteRepository.produtosFavoritos(id, estabelecimentoId, top),
    ])

    // Decimal até o fim: dividir o total em float daria dízima no ticket médio.
    const ticketMedio =
      resumo.total_compras === 0
        ? new Prisma.Decimal(0)
        : resumo.valor_total_gasto.div(resumo.total_compras).toDecimalPlaces(2)

    return {
      cliente_id: id,
      total_compras: resumo.total_compras,
      valor_total_gasto: Number(resumo.valor_total_gasto),
      ticket_medio: Number(ticketMedio),
      primeira_compra_em: resumo.primeira_compra_em,
      ultima_compra_em: resumo.ultima_compra_em,
      produtos_favoritos: produtosFavoritos,
    }
  }
}
