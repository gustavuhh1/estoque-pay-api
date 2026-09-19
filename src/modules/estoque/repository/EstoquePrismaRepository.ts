import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import { EstoqueInsuficienteError } from "@/shared/errors"
import type {
  IEstoqueRepository,
  ListMovimentacoesParams,
  RegistrarMovimentacaoParams,
} from "./IEstoqueRepository"

const RELACOES_DA_MOVIMENTACAO = {
  produto: { select: { nome: true } },
  // A relação com User chama-se `users` no schema (singular User, nome plural).
  users: { select: { name: true } },
} as const

export class EstoquePrismaRepository implements IEstoqueRepository {
  constructor(private prisma: PrismaClient) {}

  async registrarMovimentacao(params: RegistrarMovimentacaoParams) {
    const quantidade = new Prisma.Decimal(params.quantidade.toString())

    return this.prisma.$transaction(async (tx) => {
      // Aritmética no banco (SET quantidade_atual = quantidade_atual ± $1), não
      // em JS: o UPDATE pega row lock, então duas saídas concorrentes serializam
      // aqui e o valor retornado já é o saldo real. O caminho ingênuo
      // (ler -> calcular -> gravar) perderia uma das duas (lost update).
      const produto = await tx.produto.update({
        where: { id: params.produto_id },
        data: {
          quantidade_atual:
            params.tipo === "ENTRADA" ? { increment: quantidade } : { decrement: quantidade },
        },
        select: { quantidade_atual: true },
      })

      // Decimal.lessThan, nunca `<` de JS (RN04). Lançar aqui derruba a
      // transação inteira: o UPDATE acima volta atrás junto com o insert de
      // auditoria abaixo — RN05, nunca um sem o outro.
      if (produto.quantidade_atual.lessThan(0)) {
        throw new EstoqueInsuficienteError(
          Number(produto.quantidade_atual.add(quantidade)),
          params.quantidade
        )
      }

      return tx.movimentacaoEstoque.create({
        data: {
          estabelecimento_id: params.estabelecimento_id,
          produto_id: params.produto_id,
          usuario_id: params.usuario_id,
          quantidade,
          tipo: params.tipo,
          motivo: params.motivo,
          observacao: params.observacao ?? null,
        },
        include: RELACOES_DA_MOVIMENTACAO,
      })
    })
  }

  async findManyByEstabelecimento(
    estabelecimentoId: string,
    params: ListMovimentacoesParams
  ) {
    const where = {
      estabelecimento_id: estabelecimentoId,
      ...(params.produto_id !== undefined && { produto_id: params.produto_id }),
    }

    const [data, total] = await Promise.all([
      this.prisma.movimentacaoEstoque.findMany({
        where,
        include: RELACOES_DA_MOVIMENTACAO,
        orderBy: { criado_em: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.movimentacaoEstoque.count({ where }),
    ])

    return { data, total }
  }

  async findProdutosComEstoqueBaixo(estabelecimentoId: string) {
    return this.prisma.produto.findMany({
      where: {
        estabelecimento_id: estabelecimentoId,
        ativo: true,
        deletado_em: null,
        // Field reference do Prisma: compara duas colunas da mesma linha, sem
        // precisar de $queryRaw nem de filtrar em memória.
        quantidade_atual: { lte: this.prisma.produto.fields.quantidade_minima },
      },
      orderBy: { nome: "asc" },
    })
  }
}
