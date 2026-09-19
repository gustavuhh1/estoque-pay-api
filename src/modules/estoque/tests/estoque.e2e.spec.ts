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

async function criarProdutoDireto(
  estabelecimentoId: string,
  overrides: Partial<{
    nome: string
    quantidade_atual: number
    quantidade_minima: number
    ativo: boolean
  }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto de Teste",
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: overrides.quantidade_atual ?? 100,
      quantidade_minima: overrides.quantidade_minima ?? 0,
      ativo: overrides.ativo ?? true,
    },
  })
}

describe("Estoque Module - E2E (DB Real)", () => {
  describe("POST /estoque/movimentacao (#47)", () => {
    it("201 — registra a entrada e credita o responsável pela sessão", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 10 })

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 5,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().usuario_id).toBe(user.id)
      expect(response.json().usuario_nome).toBe(user.name)
      expect(response.json().quantidade).toBe(5)

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(15)
    })

    it("201 — RN04: aceita saída fracionada de 0.300", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 1 })

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 0.3,
          motivo: "DESCARTE",
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().quantidade).toBe(0.3)

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(0.7)
    })

    it("400 — motivo VENDA é reservado ao PDV e não passa no schema", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 1,
          motivo: "VENDA",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("400 — motivo incoerente com o tipo (REABASTECIMENTO em SAIDA)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("400 — quantidade com mais de 3 casas decimais", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1.2345,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("409 — saída maior que o saldo disponível", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 3 })

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 10,
          motivo: "PERDA",
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("ESTOQUE_INSUFICIENTE")

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(3)
    })

    it("404 — produto de outra loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: {
          produto_id: produtoDaLojaB.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("PRODUTO_NAO_ENCONTRADO")
    })

    it("403 — CASHIER não pode movimentar estoque", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_ESTOQUE")
    })

    it("400 — sem o header x-estabelecimento-id", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { cookie },
        payload: {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers: { "x-estabelecimento-id": loja.id },
        payload: {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe("GET /estoque/movimentacoes (#48)", () => {
    it("200 — devolve o envelope paginado com nome de produto e usuário", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { nome: "Queijo Minas" })
      await prisma.movimentacaoEstoque.create({
        data: {
          estabelecimento_id: loja.id,
          produto_id: produto.id,
          usuario_id: user.id,
          quantidade: 2,
          tipo: "SAIDA",
          motivo: "PERDA",
        },
      })

      const response = await app.inject({
        method: "GET",
        url: "/estoque/movimentacoes",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(1)
      expect(response.json().page).toBe(1)
      expect(response.json().limit).toBe(20)
      expect(response.json().data[0].produto_nome).toBe("Queijo Minas")
      expect(response.json().data[0].usuario_nome).toBe(user.name)
    })

    it("200 — respeita page e limit da querystring", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)
      for (const quantidade of [1, 2, 3]) {
        await prisma.movimentacaoEstoque.create({
          data: {
            estabelecimento_id: loja.id,
            produto_id: produto.id,
            usuario_id: user.id,
            quantidade,
            tipo: "ENTRADA",
            motivo: "REABASTECIMENTO",
          },
        })
      }

      const response = await app.inject({
        method: "GET",
        url: "/estoque/movimentacoes?page=2&limit=1",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(3)
      expect(response.json().page).toBe(2)
      expect(response.json().limit).toBe(1)
      expect(response.json().data).toHaveLength(1)
    })

    it("400 — limit acima do teto de 100", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "GET",
        url: "/estoque/movimentacoes?limit=101",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("403 — CASHIER não pode consultar a auditoria", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "GET",
        url: "/estoque/movimentacoes",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_ESTOQUE")
    })
  })

  describe("GET /estoque/alertas (#49)", () => {
    it("200 — retorna só os produtos no mínimo ou abaixo", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      await criarProdutoDireto(loja.id, {
        nome: "Em alerta",
        quantidade_atual: 2,
        quantidade_minima: 5,
      })
      await criarProdutoDireto(loja.id, {
        nome: "Tranquilo",
        quantidade_atual: 50,
        quantidade_minima: 5,
      })

      const response = await app.inject({
        method: "GET",
        url: "/estoque/alertas",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
      expect(response.json()[0].nome).toBe("Em alerta")
      expect(response.json()[0].quantidade_atual).toBe(2)
      expect(response.json()[0].quantidade_minima).toBe(5)
    })

    it("200 — exclui inativos mesmo zerados", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      await criarProdutoDireto(loja.id, {
        quantidade_atual: 0,
        quantidade_minima: 5,
        ativo: false,
      })

      const response = await app.inject({
        method: "GET",
        url: "/estoque/alertas",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(0)
    })

    it("403 — CASHIER não pode consultar alertas", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "GET",
        url: "/estoque/alertas",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_ESTOQUE")
    })
  })
})
