import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type {
  AbrirTurnoParams,
  FecharTurnoParams,
  ICaixaRepository,
} from "./ICaixaRepository"

const RELACOES_DO_TURNO = {
  aberto_por: { select: { name: true } },
  fechado_por: { select: { name: true } },
} as const

export class CaixaPrismaRepository implements ICaixaRepository {
  constructor(private prisma: PrismaClient) {}

  async abrir(params: AbrirTurnoParams) {
    return this.prisma.turnoCaixa.create({
      data: {
        estabelecimento_id: params.estabelecimento_id,
        aberto_por_id: params.aberto_por_id,
        valor_abertura: new Prisma.Decimal(params.valor_abertura.toString()),
      },
      include: RELACOES_DO_TURNO,
    })
  }

  async fechar(params: FecharTurnoParams) {
    return this.prisma.turnoCaixa.update({
      where: { id: params.id },
      data: {
        status: "FECHADO",
        fechado_por_id: params.fechado_por_id,
        valor_fechamento: new Prisma.Decimal(params.valor_fechamento.toString()),
        fechado_em: new Date(),
      },
      include: RELACOES_DO_TURNO,
    })
  }

  async findAbertoByEstabelecimento(estabelecimentoId: string) {
    // findFirst e não findUnique: a unicidade de "um ABERTO por loja" vem do
    // índice PARCIAL criado em SQL na migration, que o Prisma não conhece e
    // portanto não expõe como chave única no client.
    return this.prisma.turnoCaixa.findFirst({
      where: { estabelecimento_id: estabelecimentoId, status: "ABERTO" },
      include: RELACOES_DO_TURNO,
    })
  }
}
