import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  EstoqueInsuficienteError,
  TurnoFechadoError,
  ValorPagoInsuficienteError,
} from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { CaixaPrismaRepository } from "@/modules/caixa/repository/CaixaPrismaRepository"
import { VendaPrismaRepository } from "@/modules/venda/repository/VendaPrismaRepository"
import { VendaService } from "@/modules/venda/service/VendaService"
import { PagamentoService } from "../service/PagamentoService"

const CNPJ_VALIDO = "11222333000181"

async function criarUsuario() {
  return prisma.user.create({
    data: { id: randomUUID(), email: `user-${randomUUID()}@email.com`, name: "Caixa" },
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

describe("PagamentoService.registrarPagamentoManual (#51 — RF02.1/RF02.2/RNF01)", () => {
  let sut: PagamentoService
  let caixaRepository: CaixaPrismaRepository

  beforeEach(() => {
    const estoqueRepository = new EstoquePrismaRepository(prisma)
    const vendaRepository = new VendaPrismaRepository(prisma, estoqueRepository)
    caixaRepository = new CaixaPrismaRepository(prisma)
    sut = new PagamentoService(
      vendaRepository,
      new VendaService(new ProdutoPrismaRepository(prisma), vendaRepository),
      caixaRepository
    )
  })

  /** Loja com turno aberto e um usuário, o cenário mínimo para vender. */
  async function cenario() {
    const loja = await criarEstabelecimento()
    const usuario = await criarUsuario()
    const turno = await caixaRepository.abrir({
      estabelecimento_id: loja.id,
      aberto_por_id: usuario.id,
      valor_abertura: 200,
    })
    return { loja, usuario, turno }
  }

  it("fecha a venda como PAGO, amarrada ao turno aberto", async () => {
    const { loja, usuario, turno } = await cenario()
    const produto = await criarProduto(loja.id, { preco_venda: 10 })

    const { venda } = await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 3 }],
      metodo_pagamento: "DEBITO",
    })

    expect(venda.status_pagamento).toBe("PAGO")
    expect(venda.pago_em).toBeInstanceOf(Date)
    expect(venda.turno_id).toBe(turno.id)
    expect(Number(venda.total_venda)).toBe(30)
    expect(venda.itens).toHaveLength(1)
  })

  it("baixa o estoque e grava a auditoria com motivo VENDA", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { quantidade_atual: 10 })

    await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 4 }],
      metodo_pagamento: "CREDITO",
    })

    const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
    expect(Number(noBanco.quantidade_atual)).toBe(6)

    const movimentacao = await prisma.movimentacaoEstoque.findFirstOrThrow()
    expect(movimentacao.tipo).toBe("SAIDA")
    expect(movimentacao.motivo).toBe("VENDA")
    expect(movimentacao.usuario_id).toBe(usuario.id)
  })

  it("calcula o troco em dinheiro", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { preco_venda: 49.9 })

    const { troco, valor_pago } = await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 1 }],
      metodo_pagamento: "DINHEIRO",
      valor_pago: 50,
    })

    // 50 - 49.9 dá 0.09999999999999432 em float. Com Decimal, 0.1.
    expect(troco).toBe(0.1)
    expect(valor_pago).toBe(50)
  })

  it("troco é null em cartão", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id)

    const { troco } = await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 1 }],
      metodo_pagamento: "DEBITO",
    })

    expect(troco).toBeNull()
  })

  it("valor pago menor que o total é recusado", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { preco_venda: 100 })

    await expect(
      sut.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DINHEIRO",
        valor_pago: 99.99,
      })
    ).rejects.toBeInstanceOf(ValorPagoInsuficienteError)

    expect(await prisma.venda.count()).toBe(0)
  })

  it("valor pago exatamente igual ao total é aceito, com troco zero", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { preco_venda: 25 })

    const { troco } = await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 2 }],
      metodo_pagamento: "DINHEIRO",
      valor_pago: 50,
    })

    expect(troco).toBe(0)
  })

  it("não vende com o caixa fechado", async () => {
    const loja = await criarEstabelecimento()
    const usuario = await criarUsuario()
    const produto = await criarProduto(loja.id)

    await expect(
      sut.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DINHEIRO",
        valor_pago: 100,
      })
    ).rejects.toBeInstanceOf(TurnoFechadoError)

    expect(await prisma.venda.count()).toBe(0)
  })

  it("usa o preço do BANCO, ignorando qualquer preço do cliente", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { preco_venda: 100 })

    const { venda } = await sut.registrarPagamentoManual(loja.id, usuario.id, {
      // O DTO nem aceita preço; isto documenta que o total vem do banco.
      itens: [{ produto_id: produto.id, quantidade: 1 }],
      metodo_pagamento: "DEBITO",
    })

    expect(Number(venda.total_venda)).toBe(100)
    expect(Number(venda.itens[0]?.preco_unitario)).toBe(100)
  })

  /**
   * O teste central da RNF01: dois itens, o segundo estoura o saldo. Nada pode
   * sobrar — nem a Venda, nem os itens, nem a baixa do PRIMEIRO produto.
   */
  it("RNF01 — falha na baixa do 2º item desfaz a venda INTEIRA", async () => {
    const { loja, usuario } = await cenario()
    const comSaldo = await criarProduto(loja.id, {
      nome: "Com saldo",
      quantidade_atual: 10,
    })
    const semSaldo = await criarProduto(loja.id, {
      nome: "Sem saldo",
      quantidade_atual: 1,
    })

    await expect(
      sut.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [
          { produto_id: comSaldo.id, quantidade: 2 },
          { produto_id: semSaldo.id, quantidade: 999 },
        ],
        metodo_pagamento: "DINHEIRO",
        valor_pago: 100000,
      })
    ).rejects.toBeInstanceOf(EstoqueInsuficienteError)

    // A baixa do primeiro item precisa ter voltado atrás junto.
    const primeiro = await prisma.produto.findUniqueOrThrow({ where: { id: comSaldo.id } })
    expect(Number(primeiro.quantidade_atual)).toBe(10)

    expect(await prisma.venda.count()).toBe(0)
    expect(await prisma.itemVenda.count()).toBe(0)
    expect(await prisma.movimentacaoEstoque.count()).toBe(0)
  })

  it("saída exatamente igual ao saldo é permitida e zera o produto", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id, { quantidade_atual: 5 })

    await sut.registrarPagamentoManual(loja.id, usuario.id, {
      itens: [{ produto_id: produto.id, quantidade: 5 }],
      metodo_pagamento: "DEBITO",
    })

    const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
    expect(Number(noBanco.quantidade_atual)).toBe(0)
  })

  it("produto inativo não entra na venda", async () => {
    const { loja, usuario } = await cenario()
    const produto = await criarProduto(loja.id)
    await prisma.produto.update({ where: { id: produto.id }, data: { ativo: false } })

    await expect(
      sut.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DEBITO",
      })
    ).rejects.toMatchObject({ code: "PRODUTO_INATIVO" })
  })
})
