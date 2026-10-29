import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js"
import type { EspelhoNfce } from "../espelho"
import type {
  INfceRepository,
  NotaRegistrada,
  RegistrarNotaParams,
  VendaParaNota,
} from "./INfceRepository"

const RELACOES_PARA_NOTA = {
  itens: { include: { produto: { select: { nome: true } } } },
  cliente: { select: { nome: true, cpf: true } },
  estabelecimento: { select: { nome: true, cnpj: true, ie: true, emite_nfce: true } },
} as const

export class NfcePrismaRepository implements INfceRepository {
  constructor(private prisma: PrismaClient) {}

  async findVendaParaNota(vendaId: string): Promise<VendaParaNota | null> {
    const venda = await this.prisma.venda.findUnique({
      where: { id: vendaId },
      include: RELACOES_PARA_NOTA,
    })

    return venda as VendaParaNota | null
  }

  async registrarNota({ venda_id, gerar }: RegistrarNotaParams) {
    return this.prisma.$transaction(async (tx) => {
      // Reserva a venda: só quem encontra `nfe_numero` nulo segue. O Postgres
      // serializa o update na linha, então uma emissão concorrente espera esta
      // terminar, encontra o número preenchido e sai com count 0.
      const reservada = await tx.venda.updateMany({
        where: { id: venda_id, nfe_numero: null },
        data: { nfe_status: "PROCESSANDO", nfe_tentativas: { increment: 1 } },
      })

      if (reservada.count === 0) {
        return { criada: false }
      }

      const venda = await tx.venda.findUniqueOrThrow({
        where: { id: venda_id },
        select: { estabelecimento_id: true },
      })

      // Contador atômico por loja: o increment devolve o valor já somado, sem
      // read-modify-write em JS.
      const loja = await tx.estabelecimento.update({
        where: { id: venda.estabelecimento_id },
        data: { nfce_ultimo_numero: { increment: 1 } },
        select: { nfce_ultimo_numero: true },
      })

      const espelho = await gerar(loja.nfce_ultimo_numero)

      await tx.venda.update({
        where: { id: venda_id },
        data: {
          nfe_numero: espelho.numero,
          nfe_espelho: espelho as unknown as Prisma.InputJsonValue,
          nfe_status: "AUTORIZADA",
          chave_de_acesso: espelho.chave_de_acesso,
          nfe_enviada_em: new Date(espelho.emitida_em),
          nfe_erro_mensagem: null,
        },
      })

      return { criada: true }
    })
  }

  async registrarErro(vendaId: string, mensagem: string) {
    await this.prisma.venda.updateMany({
      // Nunca sobrescreve uma nota que já foi emitida.
      where: { id: vendaId, nfe_numero: null },
      data: {
        nfe_status: "ERRO",
        nfe_erro_mensagem: mensagem.slice(0, 500),
        nfe_tentativas: { increment: 1 },
      },
    })
  }

  async findNota(vendaId: string, estabelecimentoId: string) {
    const venda = await this.prisma.venda.findFirst({
      where: { id: vendaId, estabelecimento_id: estabelecimentoId, nfe_numero: { not: null } },
    })

    return venda ? this.paraNota(venda) : null
  }

  async listar(estabelecimentoId: string, { page, limit }: { page: number; limit: number }) {
    const where = { estabelecimento_id: estabelecimentoId, nfe_numero: { not: null } }

    const [vendas, total] = await Promise.all([
      this.prisma.venda.findMany({
        where,
        orderBy: { nfe_numero: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.venda.count({ where }),
    ])

    return { data: vendas.map((venda) => this.paraNota(venda)), total }
  }

  private paraNota(venda: {
    id: string
    nfe_numero: number | null
    nfe_status: NotaRegistrada["status"] | null
    nfe_espelho: Prisma.JsonValue | null
  }): NotaRegistrada {
    return {
      venda_id: venda.id,
      numero: venda.nfe_numero as number,
      status: venda.nfe_status ?? "AUTORIZADA",
      espelho: venda.nfe_espelho as unknown as EspelhoNfce,
    }
  }
}
