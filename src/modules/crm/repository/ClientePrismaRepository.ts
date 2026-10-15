import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { ProdutoFavorito } from "../dto/cliente.dto"
import type {
  CreateClienteParams,
  IClienteRepository,
  ListClientesParams,
  UpdateClienteParams,
} from "./IClienteRepository"

/** Mesmo include do VendaPrismaRepository: o contrato `VendaComItens`. */
const RELACOES_DA_VENDA = {
  itens: { include: { produto: { select: { nome: true } } } },
} as const

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

  async findCompras(
    clienteId: string,
    estabelecimentoId: string,
    params: { page: number; limit: number }
  ) {
    // `estabelecimento_id` redundante com o cliente de propósito: a venda é
    // filtrada pela loja ativa mesmo que um dia um cliente_id de outra loja
    // escape para cá.
    const where = { cliente_id: clienteId, estabelecimento_id: estabelecimentoId }

    const [data, total] = await Promise.all([
      this.prisma.venda.findMany({
        where,
        include: RELACOES_DA_VENDA,
        orderBy: { criada_em: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.venda.count({ where }),
    ])

    return { data, total }
  }

  async resumoDeCompras(clienteId: string, estabelecimentoId: string) {
    const resumo = await this.prisma.venda.aggregate({
      where: {
        cliente_id: clienteId,
        estabelecimento_id: estabelecimentoId,
        status_pagamento: "PAGO",
      },
      _count: { _all: true },
      _sum: { total_venda: true },
      _min: { criada_em: true },
      _max: { criada_em: true },
    })

    return {
      total_compras: resumo._count._all,
      valor_total_gasto: resumo._sum.total_venda ?? new Prisma.Decimal(0),
      primeira_compra_em: resumo._min.criada_em,
      ultima_compra_em: resumo._max.criada_em,
    }
  }

  async produtosFavoritos(
    clienteId: string,
    estabelecimentoId: string,
    top: number
  ): Promise<ProdutoFavorito[]> {
    const agrupados = await this.prisma.itemVenda.groupBy({
      by: ["produto_id"],
      where: {
        venda: {
          cliente_id: clienteId,
          estabelecimento_id: estabelecimentoId,
          status_pagamento: "PAGO",
        },
      },
      _count: { produto_id: true },
      _sum: { quantidade: true },
      // Frequência primeiro: somar quantidade de produto em kg com produto em
      // unidade não diz qual é o favorito. A soma só desempata. O produto_id
      // fecha o desempate para a ordem ser estável entre chamadas.
      orderBy: [
        { _count: { produto_id: "desc" } },
        { _sum: { quantidade: "desc" } },
        { produto_id: "asc" },
      ],
      take: top,
    })

    if (agrupados.length === 0) return []

    // O groupBy do Prisma não faz include: o nome vem numa segunda query só
    // com os ids do top N. Inclui soft-deletados de propósito — o produto saiu
    // do catálogo, mas continua sendo o que o cliente comprou.
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: agrupados.map((item) => item.produto_id) } },
      select: { id: true, nome: true },
    })
    const nomePorId = new Map(produtos.map((produto) => [produto.id, produto.nome]))

    return agrupados.map((item) => ({
      produto_id: item.produto_id,
      produto_nome: nomePorId.get(item.produto_id) ?? "",
      vezes_comprado: item._count.produto_id,
      quantidade_total: Number(item._sum.quantidade ?? 0),
    }))
  }
}
