import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/prisma"
import { CategoriaNomeAlreadyInUseError, ForbiddenError, NotFoundError } from "@/shared/errors"
import { CategoriaService } from "../service/CategoriaService"
import { CategoriaPrismaRepository } from "../repository/CategoriaPrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj },
  })
}

async function criarProdutoDireto(
  estabelecimentoId: string,
  overrides: Partial<{ nome: string }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto de Teste",
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 100,
    },
  })
}

describe("CategoriaService", () => {
  let sut: CategoriaService

  beforeEach(() => {
    sut = new CategoriaService(new CategoriaPrismaRepository(prisma))
  })

  describe("create (#46 — RF07.1 / RF11.5)", () => {
    it("cria a categoria sem produtos vinculados", async () => {
      const loja = await criarEstabelecimento()

      const categoria = await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      expect(categoria.nome).toBe("Bebidas")
      expect(categoria.produtos).toHaveLength(0)
    })

    it("cria a categoria já vinculando produtos existentes da loja (RF11.5)", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)

      const categoria = await sut.create(loja.id, "OWNER", {
        nome: "Frios",
        produto_ids: [produto.id],
      })

      expect(categoria.produtos).toHaveLength(1)
      expect(categoria.produtos[0]?.id).toBe(produto.id)
    })

    it("lança NotFoundError se algum produto_id não pertence à loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await expect(
        sut.create(lojaA.id, "OWNER", { nome: "Bebidas", produto_ids: [produtoDaLojaB.id] })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lança CategoriaNomeAlreadyInUseError se o nome já existe na mesma loja", async () => {
      const loja = await criarEstabelecimento()
      await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      await expect(sut.create(loja.id, "OWNER", { nome: "Bebidas" })).rejects.toBeInstanceOf(
        CategoriaNomeAlreadyInUseError
      )
    })

    it("permite o mesmo nome em lojas diferentes", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await sut.create(lojaA.id, "OWNER", { nome: "Bebidas" })

      const categoria = await sut.create(lojaB.id, "OWNER", { nome: "Bebidas" })

      expect(categoria.id).toBeDefined()
    })

    it("CASHIER não pode criar categoria", async () => {
      const loja = await criarEstabelecimento()

      await expect(
        sut.create(loja.id, "CASHIER", { nome: "Proibido" })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("list (#46 — RF08.2)", () => {
    it("retorna só categorias da loja, não vaza categoria de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await sut.create(lojaA.id, "OWNER", { nome: "Bebidas" })
      await sut.create(lojaB.id, "OWNER", { nome: "Frios" })

      const resultado = await sut.list(lojaA.id, "OWNER")

      expect(resultado).toHaveLength(1)
      expect(resultado[0]?.estabelecimento_id).toBe(lojaA.id)
    })
  })

  describe("update (#46 — RF09.3)", () => {
    it("altera o nome e persiste", async () => {
      const loja = await criarEstabelecimento()
      const categoria = await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      const atualizada = await sut.update(categoria.id, loja.id, "OWNER", { nome: "Bebidas Frias" })

      expect(atualizada.nome).toBe("Bebidas Frias")
    })

    it("lança NotFoundError ao editar categoria de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const categoriaDaLojaB = await sut.create(lojaB.id, "OWNER", { nome: "Frios" })

      await expect(
        sut.update(categoriaDaLojaB.id, lojaA.id, "OWNER", { nome: "Invasão" })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lança CategoriaNomeAlreadyInUseError ao editar para um nome já usado por outra categoria da loja", async () => {
      const loja = await criarEstabelecimento()
      await sut.create(loja.id, "OWNER", { nome: "Bebidas" })
      const alvo = await sut.create(loja.id, "OWNER", { nome: "Frios" })

      await expect(
        sut.update(alvo.id, loja.id, "OWNER", { nome: "Bebidas" })
      ).rejects.toBeInstanceOf(CategoriaNomeAlreadyInUseError)
    })
  })

  describe("addProdutos (#46 — RF11.5, connect)", () => {
    it("adiciona produtos sem afetar os já vinculados", async () => {
      const loja = await criarEstabelecimento()
      const produtoA = await criarProdutoDireto(loja.id, { nome: "Produto A" })
      const produtoB = await criarProdutoDireto(loja.id, { nome: "Produto B" })
      const categoria = await sut.create(loja.id, "OWNER", {
        nome: "Bebidas",
        produto_ids: [produtoA.id],
      })

      const atualizada = await sut.addProdutos(categoria.id, loja.id, "OWNER", [produtoB.id])

      const idsVinculados = atualizada.produtos.map((produto) => produto.id).sort()
      expect(idsVinculados).toEqual([produtoA.id, produtoB.id].sort())
    })

    it("lança NotFoundError se a categoria não existe nesta loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const categoriaDaLojaB = await sut.create(lojaB.id, "OWNER", { nome: "Frios" })
      const produto = await criarProdutoDireto(lojaA.id)

      await expect(
        sut.addProdutos(categoriaDaLojaB.id, lojaA.id, "OWNER", [produto.id])
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lança NotFoundError se o produto não pertence à loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const categoria = await sut.create(lojaA.id, "OWNER", { nome: "Bebidas" })
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await expect(
        sut.addProdutos(categoria.id, lojaA.id, "OWNER", [produtoDaLojaB.id])
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("CASHIER não pode adicionar produtos", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      await expect(
        sut.addProdutos(categoria.id, loja.id, "CASHIER", [produto.id])
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("removeProdutos (#46 — RF11.5 / RN08, disconnect)", () => {
    it("remove só os produtos informados, sem afetar os demais nem o Produto em si", async () => {
      const loja = await criarEstabelecimento()
      const produtoA = await criarProdutoDireto(loja.id, { nome: "Produto A" })
      const produtoB = await criarProdutoDireto(loja.id, { nome: "Produto B" })
      const categoria = await sut.create(loja.id, "OWNER", {
        nome: "Bebidas",
        produto_ids: [produtoA.id, produtoB.id],
      })

      const atualizada = await sut.removeProdutos(categoria.id, loja.id, "OWNER", [produtoA.id])

      expect(atualizada.produtos).toHaveLength(1)
      expect(atualizada.produtos[0]?.id).toBe(produtoB.id)

      const produtoNoBanco = await prisma.produto.findUnique({ where: { id: produtoA.id } })
      expect(produtoNoBanco).not.toBeNull()
    })

    it("é idempotente: remover um produto que não está vinculado não lança erro", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      const atualizada = await sut.removeProdutos(categoria.id, loja.id, "OWNER", [produto.id])

      expect(atualizada.produtos).toHaveLength(0)
    })

    it("lança NotFoundError se a categoria não existe nesta loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produto = await criarProdutoDireto(lojaB.id)
      const categoriaDaLojaB = await sut.create(lojaB.id, "OWNER", {
        nome: "Frios",
        produto_ids: [produto.id],
      })

      await expect(
        sut.removeProdutos(categoriaDaLojaB.id, lojaA.id, "OWNER", [produto.id])
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("CASHIER não pode remover produtos", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await sut.create(loja.id, "OWNER", {
        nome: "Bebidas",
        produto_ids: [produto.id],
      })

      await expect(
        sut.removeProdutos(categoria.id, loja.id, "CASHIER", [produto.id])
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("delete (#46 — RF10.4 / RN02 / RN08)", () => {
    it("exclui a categoria mesmo com produtos vinculados, sem apagar os produtos", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await sut.create(loja.id, "OWNER", {
        nome: "Bebidas",
        produto_ids: [produto.id],
      })

      await sut.delete(categoria.id, loja.id, "OWNER")

      const categoriaNoBanco = await prisma.categoria.findUnique({ where: { id: categoria.id } })
      expect(categoriaNoBanco).toBeNull()

      const produtoNoBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(produtoNoBanco).not.toBeNull()
    })

    it("lança NotFoundError ao excluir categoria de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const categoriaDaLojaB = await sut.create(lojaB.id, "OWNER", { nome: "Frios" })

      await expect(sut.delete(categoriaDaLojaB.id, lojaA.id, "OWNER")).rejects.toBeInstanceOf(
        NotFoundError
      )
    })

    it("CASHIER não pode excluir categoria", async () => {
      const loja = await criarEstabelecimento()
      const categoria = await sut.create(loja.id, "OWNER", { nome: "Bebidas" })

      await expect(sut.delete(categoria.id, loja.id, "CASHIER")).rejects.toBeInstanceOf(
        ForbiddenError
      )
    })
  })
})
