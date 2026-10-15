import type { Prisma, PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  CreateClienteParams,
  IClienteRepository,
  ListClientesParams,
  UpdateClienteParams,
} from "./IClienteRepository"

export class ClientePrismaRepository implements IClienteRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateClienteParams) {
    return this.prisma.cliente.create({
      data: {
        estabelecimento_id: data.estabelecimento_id,
        nome: data.nome,
        cpf: data.cpf,
        telefone: data.telefone ?? null,
        data_nascimento: data.data_nascimento ?? null,
        observacao: data.observacao ?? null,
      },
    })
  }

  async findManyByEstabelecimento(estabelecimentoId: string, params: ListClientesParams) {
    const where: Prisma.ClienteWhereInput = {
      estabelecimento_id: estabelecimentoId,
      ...(params.busca !== undefined && {
        OR: [
          { nome: { contains: params.busca, mode: "insensitive" } },
          // O CPF é gravado só com dígitos, então a busca também precisa ser
          // só dígitos — senão "529.982" nunca casaria. Busca sem nenhum
          // dígito (um nome) cai fora deste ramo.
          ...(/\d/.test(params.busca)
            ? [{ cpf: { startsWith: params.busca.replace(/\D/g, "") } }]
            : []),
        ],
      }),
    }

    // Mesmo padrão da listagem de movimentações de estoque.
    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        orderBy: { nome: "asc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.cliente.count({ where }),
    ])

    return { data, total }
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.cliente.findFirst({
      where: { id, estabelecimento_id: estabelecimentoId },
    })
  }

  async update(id: string, data: UpdateClienteParams) {
    // Mesmo spread condicional do ProdutoPrismaRepository: o
    // exactOptionalPropertyTypes deixa o params aceitar `campo: undefined`
    // explícito, mas o input de update do Prisma não — só presente ou ausente.
    return this.prisma.cliente.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.cpf !== undefined && { cpf: data.cpf }),
        ...(data.telefone !== undefined && { telefone: data.telefone }),
        ...(data.data_nascimento !== undefined && {
          data_nascimento: data.data_nascimento,
        }),
        ...(data.observacao !== undefined && { observacao: data.observacao }),
      },
    })
  }

  async existsCpf(estabelecimentoId: string, cpf: string, excludeId?: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: {
        estabelecimento_id: estabelecimentoId,
        cpf,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    })

    return cliente !== null
  }
}
