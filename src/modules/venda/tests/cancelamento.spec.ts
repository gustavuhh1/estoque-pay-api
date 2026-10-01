import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  ForbiddenError,
  NotFoundError,
  VendaJaCanceladaError,
  VendaNaoPagaError,
} from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { CaixaPrismaRepository } from "@/modules/caixa/repository/CaixaPrismaRepository"
import { PagamentoService } from "@/modules/pagamento/service/PagamentoService"
import { VendaPrismaRepository } from "../repository/VendaPrismaRepository"
import { VendaService } from "../service/VendaService"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarUsuario() {
  return prisma.user.create({
    data: { id: randomUUID(), email: `user-${randomUUID()}@email.com`, name: "Operador" },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarProduto(
  estabelecimentoId: string,
  overrides: Partial<{ nome: string; preco_venda: number; quantidade_atual: number }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto",
      preco_custo: 5,
      preco_venda: overrides.preco_venda ?? 10,
      quantidade_atual: overrides.quantidade_atual ?? 100,
      quantidade_minima: 0,
    },
  })
}

describe("VendaService.cancelar (#53 — RF05.1/RF05.2 + RN02/RN03)", () => {
  let sut: VendaService
  let pagamentoService: PagamentoService
  let caixaRepository: CaixaPrismaRepository

  beforeEach(() => {
    const estoqueRepository = new EstoquePrismaRepository(prisma)
    const vendaRepository = new VendaPrismaRepository(prisma, estoqueRepository)
    const produtoRepository = new ProdutoPrismaRepository(prisma)
    caixaRepository = new CaixaPrismaRepository(prisma)

    sut = new VendaService(produtoRepository, vendaRepository)
    pagamentoService = new PagamentoService(
      vendaRepository,
      new VendaService(produtoRepository, vendaRepository),
      caixaRepository
    )
  })

  /** Loja com caixa aberto, produto e uma venda PAGA — o ponto de partida. */
  async function cenarioComVendaPaga(
    overrides: Partial<{
      quantidade_atual: number
      quantidade_vendida: number
      cnpj: string
    }> = {}
  ) {
    // O CNPJ é único na plataforma, então quem chama duas vezes no mesmo teste
    // precisa passar o segundo.
    const loja = await criarEstabelecimento(overrides.cnpj ?? CNPJ_VALIDO)
    const usuario = await criarUsuario()
    await caixaRepository.abrir({
      estabelecimento_id: loja.id,
      aberto_por_id: usuario.id,
      valor_abertura: 200,
    })
    const produto = await criarProduto(loja.id, {
      quantidade_atual: overrides.quantidade_atual ?? 10,
    })

    const { venda } = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [
        { produto_id: produto.id, quantidade: overrides.quantidade_vendida ?? 3 },
      ],
      metodo_pagamento: "DEBITO",
    })

    return { loja, usuario, produto, venda }
  }

  it("marca a venda como CANCELADO registrando quem cancelou e quando", async () => {
    const { loja, usuario, venda } = await cenarioComVendaPaga()
    const gestor = await criarUsuario()

    const cancelada = await sut.cancelar(loja.id, gestor.id, "MANAGER", venda.id)

    expect(cancelada.status_pagamento).toBe("CANCELADO")
    expect(cancelada.cancelada_por_id).toBe(gestor.id)
    expect(cancelada.cancelada_em).toBeInstanceOf(Date)
    // Quem vendeu continua registrado — são campos diferentes.
    expect(cancelada.usuario_id).toBe(usuario.id)
  })

  it("RF05.2 — devolve os itens ao estoque", async () => {
    const { loja, usuario, produto } = await cenarioComVendaPaga({
      quantidade_atual: 10,
      quantidade_vendida: 3,
    })
    const vendido = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
    expect(Number(vendido.quantidade_atual)).toBe(7)

    const venda = await prisma.venda.findFirstOrThrow()
    await sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)

    const devolvido = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
    expect(Number(devolvido.quantidade_atual)).toBe(10)
  })

  it("RN03 — gera ENTRADA com motivo ESTORNO_VENDA, sem apagar a SAIDA original", async () => {
    const { loja, usuario, venda } = await cenarioComVendaPaga()

    await sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)

    const movimentacoes = await prisma.movimentacaoEstoque.findMany({
      orderBy: { criado_em: "asc" },
    })

    // As DUAS pontas ficam no histórico: a venda não some como se nunca tivesse
    // existido.
    expect(movimentacoes).toHaveLength(2)
    expect(movimentacoes[0]?.tipo).toBe("SAIDA")
    expect(movimentacoes[0]?.motivo).toBe("VENDA")
    expect(movimentacoes[1]?.tipo).toBe("ENTRADA")
    expect(movimentacoes[1]?.motivo).toBe("ESTORNO_VENDA")
  })

  it("credita o estorno a quem cancelou, não a quem vendeu", async () => {
    const { loja, venda } = await cenarioComVendaPaga()
    const gestor = await criarUsuario()

    await sut.cancelar(loja.id, gestor.id, "MANAGER", venda.id)

    const estorno = await prisma.movimentacaoEstoque.findFirstOrThrow({
      where: { motivo: "ESTORNO_VENDA" },
    })
    expect(estorno.usuario_id).toBe(gestor.id)
  })

  it("devolve TODOS os itens de uma venda com vários produtos", async () => {
    const loja = await criarEstabelecimento()
    const usuario = await criarUsuario()
    await caixaRepository.abrir({
      estabelecimento_id: loja.id,
      aberto_por_id: usuario.id,
      valor_abertura: 0,
    })
    const a = await criarProduto(loja.id, { nome: "A", quantidade_atual: 10 })
    const b = await criarProduto(loja.id, { nome: "B", quantidade_atual: 20 })

    const { venda } = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [
        { produto_id: a.id, quantidade: 2 },
        { produto_id: b.id, quantidade: 5 },
      ],
      metodo_pagamento: "DEBITO",
    })

    await sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)

    expect(
      Number((await prisma.produto.findUniqueOrThrow({ where: { id: a.id } })).quantidade_atual)
    ).toBe(10)
    expect(
      Number((await prisma.produto.findUniqueOrThrow({ where: { id: b.id } })).quantidade_atual)
    ).toBe(20)
  })

  it("devolve quantidade fracionada sem perder precisão (RN04)", async () => {
    const loja = await criarEstabelecimento()
    const usuario = await criarUsuario()
    await caixaRepository.abrir({
      estabelecimento_id: loja.id,
      aberto_por_id: usuario.id,
      valor_abertura: 0,
    })
    const produto = await criarProduto(loja.id, { quantidade_atual: 1 })

    const { venda } = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 0.3 }],
      metodo_pagamento: "DEBITO",
    })
    expect(
      Number(
        (await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } }))
          .quantidade_atual
      )
    ).toBe(0.7)

    await sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)

    expect(
      Number(
        (await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } }))
          .quantidade_atual
      )
    ).toBe(1)
  })

  describe("RN02 — segurança", () => {
    it("CASHIER não pode cancelar", async () => {
      const { loja, usuario, venda } = await cenarioComVendaPaga()

      await expect(
        sut.cancelar(loja.id, usuario.id, "CASHIER", venda.id)
      ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it("CASHIER bloqueado ANTES de qualquer efeito no estoque", async () => {
      const { loja, usuario, produto, venda } = await cenarioComVendaPaga({
        quantidade_atual: 10,
        quantidade_vendida: 3,
      })

      await expect(
        sut.cancelar(loja.id, usuario.id, "CASHIER", venda.id)
      ).rejects.toBeInstanceOf(ForbiddenError)

      // Saldo continua o de depois da venda, e a venda continua PAGA.
      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(7)
      const intacta = await prisma.venda.findUniqueOrThrow({ where: { id: venda.id } })
      expect(intacta.status_pagamento).toBe("PAGO")
    })

    it("MANAGER e OWNER podem cancelar", async () => {
      const primeiro = await cenarioComVendaPaga()
      await expect(
        sut.cancelar(primeiro.loja.id, primeiro.usuario.id, "MANAGER", primeiro.venda.id)
      ).resolves.toBeTruthy()

      const segundo = await cenarioComVendaPaga({ cnpj: OUTRO_CNPJ_VALIDO })
      await expect(
        sut.cancelar(segundo.loja.id, segundo.usuario.id, "OWNER", segundo.venda.id)
      ).resolves.toBeTruthy()
    })
  })

  describe("estados que impedem o cancelamento", () => {
    it("cancelar duas vezes é recusado (senão devolveria estoque em dobro)", async () => {
      const { loja, usuario, produto, venda } = await cenarioComVendaPaga({
        quantidade_atual: 10,
        quantidade_vendida: 3,
      })

      await sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)

      await expect(
        sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)
      ).rejects.toBeInstanceOf(VendaJaCanceladaError)

      // Voltou a 10 uma única vez, não a 13.
      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(10)
    })

    it("venda PENDENTE não pode ser cancelada (nunca baixou estoque)", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProduto(loja.id, { quantidade_atual: 10 })

      // Pix abandonado: gravado direto, sem passar pelo pagamento manual.
      const venda = await prisma.venda.create({
        data: {
          estabelecimento_id: loja.id,
          usuario_id: usuario.id,
          total_venda: 30,
          metodo_pagamento: "PIX_ABACATEPAY",
          status_pagamento: "PENDENTE",
          itens: {
            create: [
              { produto_id: produto.id, quantidade: 3, preco_unitario: 10, subtotal: 30 },
            ],
          },
        },
      })

      await expect(
        sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)
      ).rejects.toBeInstanceOf(VendaNaoPagaError)

      // "Devolver" aqui criaria 3 unidades do nada.
      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(10)
    })

    it("venda de outra loja é indistinguível de inexistente", async () => {
      const { venda } = await cenarioComVendaPaga()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const intruso = await criarUsuario()

      await expect(
        sut.cancelar(outraLoja.id, intruso.id, "OWNER", venda.id)
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("venda inexistente lança NotFoundError", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      await expect(
        sut.cancelar(loja.id, usuario.id, "OWNER", randomUUID())
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it("não exige turno aberto: dá para corrigir erro do dia anterior", async () => {
    const { loja, usuario, venda } = await cenarioComVendaPaga()

    // Fecha o caixa do dia, como aconteceria no fim do expediente.
    await caixaRepository.fechar({
      id: (await caixaRepository.findAbertoByEstabelecimento(loja.id))!.id,
      fechado_por_id: usuario.id,
      valor_fechamento: 500,
    })

    await expect(
      sut.cancelar(loja.id, usuario.id, "OWNER", venda.id)
    ).resolves.toBeTruthy()
  })
})
