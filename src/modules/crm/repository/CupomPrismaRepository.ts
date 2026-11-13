import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { CreateCupomParams, ICupomRepository } from "./ICupomRepository"

/** Resumo que a tela de gestão mostra em cada cupom: dono e quanto já foi usado. */
const RESUMO = {
  cliente: { select: { nome: true } },
  usos: { select: { desconto: true } },
} as const

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
        tipo_desconto: data.tipo_desconto,
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
      include: RESUMO,
      orderBy: { criado_em: "desc" },
    })
  }

  async findByIdAndEstabelecimento(id: string, estabelecimentoId: string) {
    return this.prisma.cupom.findFirst({ where: { id, estabelecimento_id: estabelecimentoId } })
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

  async existsUso(cupomId: string, cpf: string) {
    return (await this.prisma.cupomUso.count({ where: { cupom_id: cupomId, cpf } })) > 0
  }

  async desativar(id: string) {
    return this.prisma.cupom.update({ where: { id }, data: { desativado_em: new Date() }, include: RESUMO })
  }

  async findUsos(cupomId: string) {
    return this.prisma.cupomUso.findMany({
      where: { cupom_id: cupomId },
      include: { cliente: { select: { nome: true } } },
      orderBy: { usado_em: "desc" },
    })
  }
}
