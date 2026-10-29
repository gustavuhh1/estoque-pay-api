import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"
const CPF_VALIDO = "52998224725"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarMembroLogado(lojaId: string, role: Role = "OWNER") {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { user, headers: { cookie, "x-estabelecimento-id": lojaId } }
}

/** Loja com dono logado, caixa aberto, um produto e um cliente. */
async function cenario() {
  const loja = await criarEstabelecimento()
  const { headers } = await criarMembroLogado(loja.id)
  await app.inject({
    method: "POST",
    url: "/caixa/turno",
    headers,
    payload: { valor_abertura: 100 },
  })
  const produto = await prisma.produto.create({
    data: {
      estabelecimento_id: loja.id,
      nome: "Café",
      preco_custo: 10,
      preco_venda: 25,
      quantidade_atual: 50,
    },
  })
  const cliente = await prisma.cliente.create({
    data: { estabelecimento_id: loja.id, nome: "Maria", cpf: CPF_VALIDO },
  })
  return { loja, headers, produto, cliente }
}

describe("CRM - Histórico, Inteligência e Fidelidade E2E (#58)", () => {
  describe("POST /pagamento com cliente e cupom", () => {
    it("201 — vincula o cliente e aplica o cupom, com o código normalizado", async () => {
      const { loja, headers, produto, cliente } = await cenario()
      await prisma.cupom.create({
        data: {
          estabelecimento_id: loja.id,
          cliente_id: cliente.id,
          codigo: "FIEL-10",
          valor_desconto: 10,
        },
      })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 2 }],
          metodo_pagamento: "DINHEIRO",
          valor_pago: 50,
          cliente_id: cliente.id,
          cupom_codigo: "fiel-10",
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({
        cliente_id: cliente.id,
        subtotal: 50,
        desconto: 10,
        cupom_codigo: "FIEL-10",
        total_venda: 40,
        troco: 10,
      })
    })

    it("201 — sem cupom, desconto é 0 e subtotal = total", async () => {
      const { headers, produto } = await cenario()

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ subtotal: 25, desconto: 0, total_venda: 25 })
      expect(response.json().cupom_codigo).toBeNull()
    })

    it("404 — cliente de outra loja", async () => {
      const { headers, produto } = await cenario()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const deFora = await prisma.cliente.create({
        data: { estabelecimento_id: outraLoja.id, nome: "Fora", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: deFora.id,
        },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("CLIENTE_NAO_ENCONTRADO")
    })

    it("409 — cupom nominal sem o cliente dono", async () => {
      const { loja, headers, produto, cliente } = await cenario()
      await prisma.cupom.create({
        data: {
          estabelecimento_id: loja.id,
          cliente_id: cliente.id,
          codigo: "SO-DELA",
          valor_desconto: 5,
        },
      })

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "SO-DELA",
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("CUPOM_DE_OUTRO_CLIENTE")
    })

    it("404 — cupom inexistente", async () => {
      const { headers, produto } = await cenario()

      const response = await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "NAO-EXISTE",
        },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("CUPOM_NAO_ENCONTRADO")
    })
  })

  describe("GET /crm/clientes/:id/compras (RF02.1)", () => {
    it("200 — lista as vendas pagas com o cliente_id", async () => {
      const { headers, produto, cliente } = await cenario()
      await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: cliente.id,
        },
      })

      const response = await app.inject({
        method: "GET",
        url: `/crm/clientes/${cliente.id}/compras`,
        headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(1)
      expect(response.json().data[0].cliente_id).toBe(cliente.id)
      expect(response.json().data[0].itens[0].produto_nome).toBe("Café")
    })

    it("404 — cliente inexistente", async () => {
      const { headers } = await cenario()

      const response = await app.inject({
        method: "GET",
        url: "/crm/clientes/00000000-0000-0000-0000-000000000000/compras",
        headers,
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe("GET /crm/clientes/:id/estatisticas (RF02.2)", () => {
    it("200 — devolve o resumo e os favoritos", async () => {
      const { headers, produto, cliente } = await cenario()
      for (let i = 0; i < 2; i++) {
        await app.inject({
          method: "POST",
          url: "/pagamento",
          headers,
          payload: {
            itens: [{ produto_id: produto.id, quantidade: 1 }],
            metodo_pagamento: "DEBITO",
            cliente_id: cliente.id,
          },
        })
      }

      const response = await app.inject({
        method: "GET",
        url: `/crm/clientes/${cliente.id}/estatisticas?top=3`,
        headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        total_compras: 2,
        valor_total_gasto: 50,
        ticket_medio: 25,
        produtos_favoritos: [
          { produto_id: produto.id, produto_nome: "Café", vezes_comprado: 2, quantidade_total: 2 },
        ],
      })
    })

    it("400 — top acima do teto", async () => {
      const { headers, cliente } = await cenario()

      const response = await app.inject({
        method: "GET",
        url: `/crm/clientes/${cliente.id}/estatisticas?top=50`,
        headers,
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe("POST/GET /crm/cupons (RF02.3)", () => {
    it("201 — emite cupom nominal e lista com status DISPONIVEL", async () => {
      const { headers, cliente } = await cenario()

      const criado = await app.inject({
        method: "POST",
        url: "/crm/cupons",
        headers,
        payload: { cliente_id: cliente.id, codigo: "bem-vinda", valor_desconto: 7.5 },
      })

      expect(criado.statusCode).toBe(201)
      expect(criado.json()).toMatchObject({
        codigo: "BEM-VINDA",
        valor_desconto: 7.5,
        cliente_id: cliente.id,
        status: "DISPONIVEL",
      })

      const lista = await app.inject({
        method: "GET",
        url: `/crm/cupons?cliente_id=${cliente.id}`,
        headers,
      })

      expect(lista.statusCode).toBe(200)
      expect(lista.json()).toHaveLength(1)
    })

    it("o cupom aparece como RESGATADO depois do pagamento", async () => {
      const { headers, produto } = await cenario()
      await app.inject({
        method: "POST",
        url: "/crm/cupons",
        headers,
        payload: { codigo: "USADO", valor_desconto: 5 },
      })
      await app.inject({
        method: "POST",
        url: "/pagamento",
        headers,
        payload: {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "USADO",
        },
      })

      const lista = await app.inject({ method: "GET", url: "/crm/cupons", headers })

      expect(lista.json()[0].status).toBe("RESGATADO")
      expect(lista.json()[0].venda_id).toBeTruthy()
    })

    it("403 — CASHIER não emite cupom", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/crm/cupons",
        headers,
        payload: { valor_desconto: 5 },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_CUPONS")
    })

    it("409 — código repetido na loja", async () => {
      const { headers } = await cenario()
      const emitir = () =>
        app.inject({
          method: "POST",
          url: "/crm/cupons",
          headers,
          payload: { codigo: "REPETIDO", valor_desconto: 5 },
        })

      await emitir()
      const response = await emitir()

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("CUPOM_CODIGO_ALREADY_IN_USE")
    })

    it("400 — validade no passado", async () => {
      const { headers } = await cenario()

      const response = await app.inject({
        method: "POST",
        url: "/crm/cupons",
        headers,
        payload: { valor_desconto: 5, expira_em: "2020-01-01T00:00:00Z" },
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
