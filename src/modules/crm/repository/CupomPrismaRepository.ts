import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { CreateCupomParams, ICupomRepository } from "./ICupomRepository"

/**
 * Sem método de resgate aqui de propósito: o resgate grava `venda_id`, então
 * só pode acontecer DENTRO da transação que cria a venda — quem faz isso é o
 * VendaPrismaRepository, dono daquela transação (mesmo precedente da baixa de
 * estoque).
 */
export class CupomPrismaRepository implements ICupomRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateCupomParams) {
    return this.prisma.cupom.create({
      data: {
        estabelecimento_id: data.estabelecimento_id,
        cliente_id: data.cliente_id ?? null,
        codigo: data.codigo,
        valor_desconto: new Prisma.Decimal(data.valor_desconto.toString()),
        expira_em: data.expira_em ?? null,
      },
    })
  }

  async findManyByEstabelecimento(
    estabelecimentoId: string,
    filtros: { cliente_id?: string | undefined }
  ) {
    return this.prisma.cupom.findMany({
      where: {
        estabelecimento_id: estabelecimentoId,
        ...(filtros.cliente_id !== undefined && { cliente_id: filtros.cliente_id }),
      },
      orderBy: { criado_em: "desc" },
    })
  }

  async findByCodigo(estabelecimentoId: string, codigo: string) {
    return this.prisma.cupom.findUnique({
      where: {
        estabelecimento_id_codigo: { estabelecimento_id: estabelecimentoId, codigo },
      },
    })
  }

  async existsCodigo(estabelecimentoId: string, codigo: string) {
    return (await this.findByCodigo(estabelecimentoId, codigo)) !== null
  }
}
