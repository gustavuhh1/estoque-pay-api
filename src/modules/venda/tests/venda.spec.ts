import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { NotFoundError } from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { VendaPrismaRepository } from "../repository/VendaPrismaRepository"
import { VendaService } from "../service/VendaService"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarProduto(
  estabelecimentoId: string,
  overrides: Partial<{
    nome: string
    ean_gtin: string
    preco_venda: number
    quantidade_atual: number
    ativo: boolean
    deletado_em: Date
  }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto de Teste",
      ean_gtin: overrides.ean_gtin ?? null,
      preco_custo: 5,
      preco_venda: overrides.preco_venda ?? 10,
      quantidade_atual: overrides.quantidade_atual ?? 100,
      quantidade_minima: 0,
      ativo: overrides.ativo ?? true,
      deletado_em: overrides.deletado_em ?? null,
    },
  })
}

describe("VendaService", () => {
  let sut: VendaService

  beforeEach(() => {
    sut = new VendaService(
      new ProdutoPrismaRepository(prisma),
      new VendaPrismaRepository(prisma, new EstoquePrismaRepository(prisma))
    )
  })

  describe("buscarProdutos (#50 — RF01.1)", () => {
    it("acha por código de barras exato", async () => {
      const loja = await criarEstabelecimento()
      await criarProduto(loja.id, { nome: "Coca Lata", ean_gtin: "7894900011517" })
      await criarProduto(loja.id, { nome: "Outro", ean_gtin: "1111111111111" })

      const achados = await sut.buscarProdutos(loja.id, "7894900011517")

      expect(achados).toHaveLength(1)
      expect(achados[0]?.nome).toBe("Coca Lata")
    })

    it("acha por parte do nome, sem diferenciar maiúsculas", async () => {
      const loja = await criarEstabelecimento()
      await criarProduto(loja.id, { nome: "Refrigerante Cola" })

      expect(await sut.buscarProdutos(loja.id, "refri")).toHaveLength(1)
      expect(await sut.buscarProdutos(loja.id, "COLA")).toHaveLength(1)
    })

    it("NÃO traz produto inativo (diferente da listagem de gestão)", async () => {
      const loja = await criarEstabelecimento()
      await criarProduto(loja.id, { nome: "Fora de linha", ativo: false })

      expect(await sut.buscarProdutos(loja.id, "Fora")).toHaveLength(0)
    })

    it("NÃO traz produto soft-deletado", async () => {
      const loja = await criarEstabelecimento()
      await criarProduto(loja.id, { nome: "Excluido", deletado_em: new Date() })

      expect(await sut.buscarProdutos(loja.id, "Excluido")).toHaveLength(0)
    })

    it("não vaza produto de outra loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarProduto(outraLoja.id, { nome: "Da outra loja" })

      expect(await sut.buscarProdutos(loja.id, "Da outra")).toHaveLength(0)
    })

    it("código de barras casa exato, não parcial", async () => {
      // `contains` traria produtos cujo código apenas contém o lido, o que no
      // balcão significaria bipar um item e o sistema oferecer outro.
      const loja = await criarEstabelecimento()
      await criarProduto(loja.id, { nome: "Longo", ean_gtin: "7894900011517" })

      expect(await sut.buscarProdutos(loja.id, "789490001")).toHaveLength(0)
    })
  })

  describe("precificarCarrinho (#50 — RF01.2/RF01.3 + RN01)", () => {
    it("calcula subtotal e total com preço do banco", async () => {
      const loja = await criarEstabelecimento()
      const a = await criarProduto(loja.id, { nome: "A", preco_venda: 10 })
      const b = await criarProduto(loja.id, { nome: "B", preco_venda: 2.5 })

      const carrinho = await sut.precificarCarrinho(loja.id, [
        { produto_id: a.id, quantidade: 3 },
        { produto_id: b.id, quantidade: 2 },
      ])

      expect(carrinho.itens[0]?.subtotal).toBe(30)
      expect(carrinho.itens[1]?.subtotal).toBe(5)
      expect(carrinho.total).toBe(35)
    })

    it("RN04: aceita quantidade fracionada", async () => {
      const loja = await criarEstabelecimento()
      const queijo = await criarProduto(loja.id, { nome: "Queijo", preco_venda: 40 })

      const carrinho = await sut.precificarCarrinho(loja.id, [
        { produto_id: queijo.id, quantidade: 0.35 },
      ])

      expect(carrinho.total).toBe(14)
    })

    it("arredonda o subtotal em 2 casas antes de somar", async () => {
      // 0.333 * 10 = 3.33 (e não 3.3299999...). Sem arredondar por item, a
      // dízima propagaria para o total e o caixa fecharia com centavo errado.
      const loja = await criarEstabelecimento()
      const produto = await criarProduto(loja.id, { preco_venda: 10 })

      const carrinho = await sut.precificarCarrinho(loja.id, [
        { produto_id: produto.id, quantidade: 0.333 },
      ])

      expect(carrinho.itens[0]?.subtotal).toBe(3.33)
      expect(carrinho.total).toBe(3.33)
    })

    it("soma com Decimal, sem erro de float", async () => {
      // 0.1 + 0.2 dá 0.30000000000000004 em ponto flutuante binário.
      const loja = await criarEstabelecimento()
      const a = await criarProduto(loja.id, { nome: "A", preco_venda: 0.1 })
      const b = await criarProduto(loja.id, { nome: "B", preco_venda: 0.2 })

      const carrinho = await sut.precificarCarrinho(loja.id, [
        { produto_id: a.id, quantidade: 1 },
        { produto_id: b.id, quantidade: 1 },
      ])

      expect(carrinho.total).toBe(0.3)
    })

    it("RN01 — NÃO altera o estoque nem cria venda", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProduto(loja.id, { quantidade_atual: 100 })

      await sut.precificarCarrinho(loja.id, [
        { produto_id: produto.id, quantidade: 7 },
      ])

      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(100)
      expect(await prisma.venda.count()).toBe(0)
      expect(await prisma.itemVenda.count()).toBe(0)
      expect(await prisma.movimentacaoEstoque.count()).toBe(0)
    })

    it("produto inexistente lança NotFoundError", async () => {
      const loja = await criarEstabelecimento()

      await expect(
        sut.precificarCarrinho(loja.id, [
          { produto_id: randomUUID(), quantidade: 1 },
        ])
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("produto inativo não pode ser vendido nem informando o id", async () => {
      // A busca já esconde inativos; esta trava impede contornar pela API.
      const loja = await criarEstabelecimento()
      const produto = await criarProduto(loja.id, { ativo: false })

      await expect(
        sut.precificarCarrinho(loja.id, [{ produto_id: produto.id, quantidade: 1 }])
      ).rejects.toMatchObject({ code: "PRODUTO_INATIVO" })
    })

    it("produto de outra loja é indistinguível de inexistente", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produto = await criarProduto(outraLoja.id)

      await expect(
        sut.precificarCarrinho(loja.id, [{ produto_id: produto.id, quantidade: 1 }])
      ).rejects.toMatchObject({ code: "PRODUTO_NAO_ENCONTRADO" })
    })

    it("permite vender acima do saldo — a trava é na baixa, não aqui", async () => {
      // Calcular não reserva estoque (RN01). Quem barra saldo insuficiente é a
      // transação do pagamento, com EstoqueInsuficienteError.
      const loja = await criarEstabelecimento()
      const produto = await criarProduto(loja.id, { quantidade_atual: 1 })

      const carrinho = await sut.precificarCarrinho(loja.id, [
        { produto_id: produto.id, quantidade: 999 },
      ])

      expect(carrinho.itens).toHaveLength(1)
    })
  })
})
