import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj },
  })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({
    data: { userId, estabelecimentoId, role },
  })
}

async function criarProdutoDireto(estabelecimentoId: string, nome = "Produto de Teste") {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome,
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 100,
    },
  })
}

describe("Categoria Module - E2E (DB Real)", () => {
  describe("POST /categoria (#46 — RF07.1)", () => {
    it("201 — cria a categoria na loja ativa", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Bebidas" },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().nome).toBe("Bebidas")
      expect(response.json().produtos).toEqual([])
    })

    it("201 — RF11.5: vincula produtos existentes já na criação", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Frios", produto_ids: [produto.id] },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().produtos).toEqual([{ id: produto.id, nome: produto.nome }])
    })

    it("403 — CASHIER não pode criar categoria", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Bebidas" },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_CATEGORIAS")
    })

    it("409 — nome já cadastrado na loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      await prisma.categoria.create({ data: { estabelecimento_id: loja.id, nome: "Bebidas" } })

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Bebidas" },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("CATEGORIA_NOME_ALREADY_IN_USE")
    })

    it("404 — produto_id informado não pertence à loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: { nome: "Bebidas", produto_ids: [produtoDaLojaB.id] },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("PRODUTO_NAO_ENCONTRADO")
    })

    it("400 — nome vazio", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "" },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "POST",
        url: "/categoria",
        headers: { "x-estabelecimento-id": loja.id },
        payload: { nome: "Bebidas" },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe("GET /categoria (#46 — RF08.2)", () => {
    it("200 — lista só as categorias da loja ativa", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      await prisma.categoria.create({ data: { estabelecimento_id: lojaA.id, nome: "Bebidas" } })
      await prisma.categoria.create({ data: { estabelecimento_id: lojaB.id, nome: "Frios" } })

      const response = await app.inject({
        method: "GET",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
      expect(response.json()[0].nome).toBe("Bebidas")
    })

    it("403 — sem vínculo com a loja do header", async () => {
      const { cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "GET",
        url: "/categoria",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("TENANT_ACCESS_DENIED")
    })
  })

  describe("PATCH /categoria/:id (#46 — RF09.3 / RF11.5)", () => {
    it("200 — edita o nome e persiste", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/categoria/${categoria.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Bebidas Frias" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().nome).toBe("Bebidas Frias")
    })

    it("404 — categoria pertence a outra loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const categoriaDaLojaB = await prisma.categoria.create({
        data: { estabelecimento_id: lojaB.id, nome: "Frios" },
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/categoria/${categoriaDaLojaB.id}`,
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: { nome: "Invasão" },
      })

      expect(response.statusCode).toBe(404)
    })

    it("400 — body vazio", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/categoria/${categoria.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe("POST /categoria/:id/produtos (#46 — RF11.5, connect)", () => {
    it("200 — adiciona produtos sem afetar os já vinculados", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produtoA = await criarProdutoDireto(loja.id, "Produto A")
      const produtoB = await criarProdutoDireto(loja.id, "Produto B")
      const categoria = await prisma.categoria.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Bebidas",
          produtos: { connect: { id: produtoA.id } },
        },
      })

      const response = await app.inject({
        method: "POST",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [produtoB.id] },
      })

      expect(response.statusCode).toBe(200)
      const idsVinculados = response
        .json()
        .produtos.map((produto: { id: string }) => produto.id)
        .sort()
      expect(idsVinculados).toEqual([produtoA.id, produtoB.id].sort())
    })

    it("404 — categoria pertence a outra loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const produto = await criarProdutoDireto(lojaA.id)
      const categoriaDaLojaB = await prisma.categoria.create({
        data: { estabelecimento_id: lojaB.id, nome: "Frios" },
      })

      const response = await app.inject({
        method: "POST",
        url: `/categoria/${categoriaDaLojaB.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: { produto_ids: [produto.id] },
      })

      expect(response.statusCode).toBe(404)
    })

    it("404 — produto_id não pertence à loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: lojaA.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "POST",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: { produto_ids: [produtoDaLojaB.id] },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("PRODUTO_NAO_ENCONTRADO")
    })

    it("400 — produto_ids vazio", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "POST",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [] },
      })

      expect(response.statusCode).toBe(400)
    })

    it("403 — CASHIER não pode adicionar produtos", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "POST",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [produto.id] },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_CATEGORIAS")
    })
  })

  describe("DELETE /categoria/:id/produtos (#46 — RF11.5 / RN08, disconnect)", () => {
    it("200 — remove só os produtos informados, sem apagar o Produto em si", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produtoA = await criarProdutoDireto(loja.id, "Produto A")
      const produtoB = await criarProdutoDireto(loja.id, "Produto B")
      const categoria = await prisma.categoria.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Bebidas",
          produtos: { connect: [{ id: produtoA.id }, { id: produtoB.id }] },
        },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [produtoA.id] },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().produtos).toEqual([{ id: produtoB.id, nome: produtoB.nome }])

      const produtoNoBanco = await prisma.produto.findUnique({ where: { id: produtoA.id } })
      expect(produtoNoBanco).not.toBeNull()
    })

    it("200 — é idempotente: remover produto não vinculado não lança erro", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [produto.id] },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().produtos).toEqual([])
    })

    it("403 — CASHIER não pode remover produtos", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await prisma.categoria.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Bebidas",
          produtos: { connect: { id: produto.id } },
        },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/categoria/${categoria.id}/produtos`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { produto_ids: [produto.id] },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_CATEGORIAS")
    })
  })

  describe("DELETE /categoria/:id (#46 — RF10.4 / RN02 / RN08)", () => {
    it("204 — exclui a categoria mesmo com produtos vinculados, sem apagar os produtos", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)
      const categoria = await prisma.categoria.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Bebidas",
          produtos: { connect: { id: produto.id } },
        },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/categoria/${categoria.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(204)
      const categoriaNoBanco = await prisma.categoria.findUnique({ where: { id: categoria.id } })
      expect(categoriaNoBanco).toBeNull()
      const produtoNoBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(produtoNoBanco).not.toBeNull()
    })

    it("404 — categoria inexistente", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "DELETE",
        url: "/categoria/00000000-0000-0000-0000-000000000000",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(404)
    })

    it("403 — CASHIER não pode excluir categoria", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")
      const categoria = await prisma.categoria.create({
        data: { estabelecimento_id: loja.id, nome: "Bebidas" },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/categoria/${categoria.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_CATEGORIAS")
    })
  })
})
