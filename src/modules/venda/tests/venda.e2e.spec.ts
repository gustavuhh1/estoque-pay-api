import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarOperador(lojaId: string, role: Role = "CASHIER") {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { user, cookie }
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

async function abrirCaixa(lojaId: string, cookie: string) {
  return app.inject({
    method: "POST",
    url: "/caixa/turno",
    headers: { cookie, "x-estabelecimento-id": lojaId },
    payload: { valor_abertura: 200 },
  })
}

describe("Venda e Pagamento - E2E (#50 / #51)", () => {
  describe("GET /venda/buscar (#50 — RF01.1)", () => {
    it("200 — acha por nome parcial", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await criarProduto(loja.id, { nome: "Refrigerante Cola" })

      const response = await app.inject({
        method: "GET",
        url: "/venda/buscar?termo=refri",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
      expect(response.json()[0].nome).toBe("Refrigerante Cola")
    })

    it("400 — termo vazio", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)

      const response = await app.inject({
        method: "GET",
        url: "/venda/buscar?termo=",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(400)
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "GET",
        url: "/venda/buscar?termo=x",
        headers: { "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe("POST /venda/calcular (#50 — RN01)", () => {
    it("200 — calcula sem gravar nada", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      const produto = await criarProduto(loja.id, {
        preco_venda: 10,
        quantidade_atual: 50,
      })

      const response = await app.inject({
        method: "POST",
        url: "/venda/calcular",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { itens: [{ produto_id: produto.id, quantidade: 3 }] },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(30)

      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(50)
      expect(await prisma.venda.count()).toBe(0)
    })

    it("400 — carrinho vazio", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/venda/calcular",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { itens: [] },
      })

      expect(response.statusCode).toBe(400)
    })

    it("400 — quantidade com 4 casas decimais", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      const produto = await criarProduto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/venda/calcular",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { itens: [{ produto_id: produto.id, quantidade: 1.2345 }] },
      })

      expect(response.statusCode).toBe(400)
    })

    it("404 — produto de outra loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const { cookie } = await criarOperador(loja.id)
      const produto = await criarProduto(outraLoja.id)

      const response = await app.inject({
        method: "POST",
        url: "/venda/calcular",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { itens: [{ produto_id: produto.id, quantidade: 1 }] },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("PRODUTO_NAO_ENCONTRADO")
    })
  })

  describe("POST /pagamento (#51 — RF02.1/RF02.2)", () => {
    it("201 — venda em dinheiro devolve o troco", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id, { preco_venda: 49.9 })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DINHEIRO",
          valor_pago: 50,
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().troco).toBe(0.1)
      expect(response.json().total_venda).toBe(49.9)
      expect(response.json().turno_id).toBeTruthy()
    })

    it("201 — CASHIER pode vender (é o trabalho dele)", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "CASHIER")
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
        },
      })

      expect(response.statusCode).toBe(201)
    })

    it("409 — caixa fechado", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      const produto = await criarProduto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("TURNO_FECHADO")
    })

    it("409 — estoque insuficiente, sem deixar venda gravada", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id, { quantidade_atual: 1 })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 999 }],
          metodo_pagamento: "DEBITO",
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("ESTOQUE_INSUFICIENTE")
      expect(await prisma.venda.count()).toBe(0)
    })

    it("400 — dinheiro sem valor_pago", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DINHEIRO",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("400 — valor pago menor que o total", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id, { preco_venda: 100 })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DINHEIRO",
          valor_pago: 50,
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALOR_PAGO_INSUFICIENTE")
    })

    it("400 — PIX_ABACATEPAY é recusado na rota manual", async () => {
      // Pix não é confirmação manual do caixa: nasce PENDENTE e só vira PAGO
      // pelo webhook ou polling. Aceitar aqui deixaria marcar como pago um Pix
      // que nunca caiu.
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const produto = await criarProduto(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "PIX_ABACATEPAY",
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers: { "x-estabelecimento-id": loja.id },
        payload: {
          itens: [{ produto_id: "00000000-0000-0000-0000-000000000000", quantidade: 1 }],
          metodo_pagamento: "DEBITO",
        },
      })

      expect(response.statusCode).toBe(401)
    })

    it("fluxo completo: busca, calcula, paga e confere o estoque", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id)
      await abrirCaixa(loja.id, cookie)
      const headers = { cookie, "x-estabelecimento-id": loja.id }
      await criarProduto(loja.id, {
        nome: "Queijo Minas",
        preco_venda: 40,
        quantidade_atual: 10,
      })

      const busca = await app.inject({
        method: "GET",
        url: "/venda/buscar?termo=Queijo",
        headers,
      })
      const produtoId = busca.json()[0].id

      const calculo = await app.inject({
        method: "POST",
        url: "/venda/calcular",
        headers,
        payload: { itens: [{ produto_id: produtoId, quantidade: 0.5 }] },
      })
      expect(calculo.json().total).toBe(20)

      const pagamento = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produtoId, quantidade: 0.5 }],
          metodo_pagamento: "DINHEIRO",
          valor_pago: 20,
        },
      })

      expect(pagamento.statusCode).toBe(201)
      // O total cobrado é o mesmo que o cálculo mostrou.
      expect(pagamento.json().total_venda).toBe(20)
      expect(pagamento.json().troco).toBe(0)

      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produtoId } })
      expect(Number(noBanco.quantidade_atual)).toBe(9.5)
    })
  })
})
