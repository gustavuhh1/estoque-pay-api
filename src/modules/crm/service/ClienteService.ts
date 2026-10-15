import { Prisma, type Cliente } from "../../../../generated/prisma/client.js"
import { ClienteCpfAlreadyInUseError, NotFoundError } from "@/shared/errors"
import type {
  CreateClienteDTO,
  ListClientesQuery,
  UpdateClienteDTO,
} from "../dto/cliente.dto"
import type { ClientesPaginados, IClienteRepository } from "../repository/IClienteRepository"

/**
 * RF01.1 a RF01.4 — issue #57.
 *
 * Sem `garantirAcesso` por cargo: quem identifica o cliente no balcão é o
 * Caixa, então cadastrar, buscar e corrigir dados de cliente é trabalho de
 * qualquer membro da loja. O vínculo com a loja já foi garantido pelo
 * requireTenant.
 */
export class ClienteService {
  constructor(private clienteRepository: IClienteRepository) {}

  /** RF01.1 */
  async create(estabelecimentoId: string, data: CreateClienteDTO): Promise<Cliente> {
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
}
