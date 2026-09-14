import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { EanGtinAlreadyInUseError, ForbiddenError, NotFoundError } from "@/shared/errors"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import type { Role } from "../../../../generated/prisma/client.js"
import { ProdutoService } from "../service/ProdutoService"
import { ProdutoPrismaRepository } from "../repository/ProdutoPrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarUsuario() {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `user-${randomUUID()}@email.com`,
      name: "Usuário de Teste",
    },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO, emiteNfce = false) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj, emite_nfce: emiteNfce },
  })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({
    data: { userId, estabelecimentoId, role },
  })
}

async function criarProdutoDireto(
  estabelecimentoId: string,
  overrides: Partial<{
    nome: string
    ean_gtin: string | null
    ncm: string | null
    cfop: string | null
    ativo: boolean
  }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto de Teste",
      ean_gtin: overrides.ean_gtin ?? null,
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 100,
      ncm: overrides.ncm ?? null,
      cfop: overrides.cfop ?? null,
      ativo: overrides.ativo ?? true,
    },
  })
}

/** Simula uma venda já concluída deste produto (FK RESTRICT em ItemVenda). */
async function criarVendaDoProduto(estabelecimentoId: string, userId: string, produtoId: string) {
  const venda = await prisma.venda.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      usuario_id: userId,
      total_venda: 10,
      metodo_pagamento: "DINHEIRO",
      status_pagamento: "PAGO",
    },
  })

  return prisma.itemVenda.create({
    data: {
      venda_id: venda.id,
      produto_id: produtoId,
      quantidade: 1,
      preco_unitario: 10,
      subtotal: 10,
    },
  })
}

describe("ProdutoService", () => {
  let sut: ProdutoService

  beforeEach(() => {
    sut = new ProdutoService(
      new ProdutoPrismaRepository(prisma),
      new EstabelecimentoPrismaRepository(prisma)
    )
  })

  describe("create (#43 — RF01.1 / RN09 / RN09.1)", () => {
    it("cria com ativo=true quando emite_nfce=false, mesmo sem NCM/CFOP", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, false)

      const produto = await sut.create(loja.id, "OWNER", {
        nome: "Refrigerante",
        tipo_medida: "UNIDADE",
        preco_custo: 3,
        preco_venda: 6,
        quantidade_atual: 10,
        quantidade_minima: 0,
      })

      expect(produto.ativo).toBe(true)
    })

    it("cria com ativo=true quando emite_nfce=true e NCM+CFOP presentes", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)

      const produto = await sut.create(loja.id, "OWNER", {
        nome: "Refrigerante",
        tipo_medida: "UNIDADE",
        preco_custo: 3,
        preco_venda: 6,
        quantidade_atual: 10,
        quantidade_minima: 0,
        ncm: "22021000",
        cfop: "5102",
      })

      expect(produto.ativo).toBe(true)
    })

    it("cria com ativo=false forçado quando emite_nfce=true e falta NCM/CFOP (RN09.1) — não lança erro", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)

      const produto = await sut.create(loja.id, "OWNER", {
        nome: "Refrigerante",
        tipo_medida: "UNIDADE",
        preco_custo: 3,
        preco_venda: 6,
        quantidade_atual: 10,
        quantidade_minima: 0,
      })

      expect(produto.ativo).toBe(false)
    })

    it("lança EanGtinAlreadyInUseError se o ean_gtin já existe na mesma loja", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarProdutoDireto(loja.id, { ean_gtin: "7890000000001" })

      await expect(
        sut.create(loja.id, "OWNER", {
          nome: "Outro Produto",
          tipo_medida: "UNIDADE",
          preco_custo: 1,
          preco_venda: 2,
          quantidade_atual: 0,
          quantidade_minima: 0,
          ean_gtin: "7890000000001",
        })
      ).rejects.toBeInstanceOf(EanGtinAlreadyInUseError)
    })

    it("permite o mesmo ean_gtin em lojas diferentes", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarProdutoDireto(lojaA.id, { ean_gtin: "7890000000002" })

      const produto = await sut.create(lojaB.id, "OWNER", {
        nome: "Produto Loja B",
        tipo_medida: "UNIDADE",
        preco_custo: 1,
        preco_venda: 2,
        quantidade_atual: 0,
        quantidade_minima: 0,
        ean_gtin: "7890000000002",
      })

      expect(produto.id).toBeDefined()
    })

    it("CASHIER não pode criar produto", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)

      await expect(
        sut.create(loja.id, "CASHIER", {
          nome: "Produto Proibido",
          tipo_medida: "UNIDADE",
          preco_custo: 1,
          preco_venda: 2,
          quantidade_atual: 0,
          quantidade_minima: 0,
        })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("list (#44 — RF02.2)", () => {
    it("retorna só produtos da loja, não vaza produto de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarProdutoDireto(lojaA.id)
      await criarProdutoDireto(lojaB.id)

      const resultado = await sut.list(lojaA.id, "OWNER")

      expect(resultado).toHaveLength(1)
      expect(resultado[0]?.estabelecimento_id).toBe(lojaA.id)
    })

    it("não retorna produto soft-deletado", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      const produto = await criarProdutoDireto(loja.id)
      await prisma.produto.update({
        where: { id: produto.id },
        data: { deletado_em: new Date() },
      })

      const resultado = await sut.list(loja.id, "OWNER")

      expect(resultado).toHaveLength(0)
    })
  })

  describe("update (#44 — RF03.3 / RN09.1)", () => {
    it("altera campos normalmente e persiste", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      const produto = await criarProdutoDireto(loja.id)

      const atualizado = await sut.update(produto.id, loja.id, "OWNER", {
        nome: "Nome Novo",
        preco_venda: 15,
      })

      expect(atualizado.nome).toBe("Nome Novo")
      expect(Number(atualizado.preco_venda)).toBe(15)
    })

    it("força ativo=false ao remover NCM/CFOP com emite_nfce=true (RN09.1 no update)", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      const produto = await criarProdutoDireto(loja.id, {
        ncm: "22021000",
        cfop: "5102",
        ativo: true,
      })

      const atualizado = await sut.update(produto.id, loja.id, "OWNER", {
        ncm: null,
      })

      expect(atualizado.ativo).toBe(false)
    })

    it("lança NotFoundError ao editar produto de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await expect(
        sut.update(produtoDaLojaB.id, lojaA.id, "OWNER", { nome: "Invasão" })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lança EanGtinAlreadyInUseError ao editar para um ean_gtin já usado por outro produto da loja", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarProdutoDireto(loja.id, { ean_gtin: "7890000000003" })
      const produtoAlvo = await criarProdutoDireto(loja.id, { ean_gtin: "7890000000004" })

      await expect(
        sut.update(produtoAlvo.id, loja.id, "OWNER", { ean_gtin: "7890000000003" })
      ).rejects.toBeInstanceOf(EanGtinAlreadyInUseError)
    })
  })

  describe("delete (#44 — RF04.4)", () => {
    it("sem vendas: apaga de verdade (hard delete) o produto e seu MovimentacaoEstoque", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id)
      await prisma.movimentacaoEstoque.create({
        data: {
          estabelecimento_id: loja.id,
          produto_id: produto.id,
          usuario_id: usuario.id,
          quantidade: 10,
          tipo: "ENTRADA",
          motivo: "REABASTECIMENTO",
        },
      })

      await sut.delete(produto.id, loja.id, "OWNER")

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(noBanco).toBeNull()
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { produto_id: produto.id },
      })
      expect(movimentacoes).toHaveLength(0)
    })

    it("com vendas: faz soft delete — some da listagem, mas ItemVenda e a linha continuam intactos", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { ean_gtin: "7890000000005" })
      const itemVenda = await criarVendaDoProduto(loja.id, usuario.id, produto.id)

      await sut.delete(produto.id, loja.id, "OWNER")

      const resultado = await sut.list(loja.id, "OWNER")
      expect(resultado.find((item) => item.id === produto.id)).toBeUndefined()

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(noBanco).not.toBeNull()
      expect(noBanco?.deletado_em).not.toBeNull()
      expect(noBanco?.ean_gtin).toBeNull()

      const itemVendaNoBanco = await prisma.itemVenda.findUnique({
        where: { id: itemVenda.id },
      })
      expect(itemVendaNoBanco).not.toBeNull()
    })

    it("lança NotFoundError ao excluir produto de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await expect(sut.delete(produtoDaLojaB.id, lojaA.id, "OWNER")).rejects.toBeInstanceOf(
        NotFoundError
      )
    })
  })

  describe("inativar / reativar (#45 — RF05.5 / RF06.6 / RN09.2)", () => {
    it("inativar seta ativo=false mesmo sem NCM/CFOP e com emite_nfce=true (sempre permitido)", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      const produto = await criarProdutoDireto(loja.id, { ativo: true })

      const resultado = await sut.inativar(produto.id, loja.id, "OWNER")

      expect(resultado.ativo).toBe(false)
    })

    it("reativar seta ativo=true quando emite_nfce=false", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, false)
      const produto = await criarProdutoDireto(loja.id, { ativo: false })

      const resultado = await sut.reativar(produto.id, loja.id, "OWNER")

      expect(resultado.ativo).toBe(true)
    })

    it("reativar seta ativo=true quando emite_nfce=true e produto já tem NCM+CFOP", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      const produto = await criarProdutoDireto(loja.id, {
        ativo: false,
        ncm: "22021000",
        cfop: "5102",
      })

      const resultado = await sut.reativar(produto.id, loja.id, "OWNER")

      expect(resultado.ativo).toBe(true)
    })

    it("reativar lança ForbiddenError (RN09.2) quando emite_nfce=true e falta NCM ou CFOP", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      const produto = await criarProdutoDireto(loja.id, { ativo: false })

      await expect(sut.reativar(produto.id, loja.id, "OWNER")).rejects.toBeInstanceOf(
        ForbiddenError
      )

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(noBanco?.ativo).toBe(false)
    })

    it("CASHIER não pode inativar nem reativar", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      const produto = await criarProdutoDireto(loja.id)

      await expect(sut.inativar(produto.id, loja.id, "CASHIER")).rejects.toBeInstanceOf(
        ForbiddenError
      )
      await expect(sut.reativar(produto.id, loja.id, "CASHIER")).rejects.toBeInstanceOf(
        ForbiddenError
      )
    })
  })
})
