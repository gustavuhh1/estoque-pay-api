import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"

async function criarLoja(apta: boolean) {
  const loja = await prisma.estabelecimento.create({
    data: {
      nome: "Loja Fiscal",
      cnpj: CNPJ_VALIDO,
      ...(apta && {
        ie: "123456789",
        certificado_a1: "https://storage.example/a1.pfx",
        certificado_a1_senha: "senha-cifrada",
      }),
    },
  })

  if (apta) {
    await prisma.assinatura.create({ data: { estabelecimento_id: loja.id, status: "ACTIVE" } })
  }

  return loja
}

async function headersDe(lojaId: string, role: Role = "OWNER") {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { cookie, "x-estabelecimento-id": lojaId }
}

describe("Switch Fiscal - E2E (#59 — RN01 / RN01.1)", () => {
  describe("PATCH /estabelecimento/ativo/nfce", () => {
    it("200 — liga com a loja em conformidade", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: true },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().emite_nfce).toBe(true)
      // O schema de resposta continua sendo a whitelist: a senha não vaza.
      expect(response.json()).not.toHaveProperty("certificado_a1_senha")
    })

    it("409 — produto ativo sem NCM/CFOP bloqueia e aponta o produto", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id)
      const produto = await prisma.produto.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Sem Fiscal",
          preco_custo: 1,
          preco_venda: 2,
          quantidade_atual: 1,
        },
      })

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: true },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("NFCE_PRE_CHECK_REPROVADO")
      expect(response.json().details.pendencias).toEqual([
        {
          codigo: "PRODUTOS_SEM_NCM_CFOP",
          mensagem: expect.any(String),
          total_produtos: 1,
          produtos: [{ id: produto.id, nome: "Sem Fiscal" }],
        },
      ])
    })

    it("409 — loja recém-criada: lista todas as pendências, inclusive o Certificado A1", async () => {
      const loja = await criarLoja(false)
      const headers = await headersDe(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: true },
      })

      expect(response.statusCode).toBe(409)
      expect(
        response.json().details.pendencias.map((pendencia: { codigo: string }) => pendencia.codigo)
      ).toEqual(["PLANO_NAO_PREMIUM", "CERTIFICADO_A1_AUSENTE", "IE_AUSENTE"])
      expect(response.json().message).toContain("Certificado Digital A1")
    })

    it("200 — desligar sempre passa", async () => {
      const loja = await criarLoja(false)
      await prisma.estabelecimento.update({ where: { id: loja.id }, data: { emite_nfce: true } })
      const headers = await headersDe(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: false },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().emite_nfce).toBe(false)
    })

    it("403 — Gestor não altera o switch", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id, "MANAGER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: true },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_NFCE")
    })

    it("400 — body sem emite_nfce", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })

    it("401 — sem sessão", async () => {
      const loja = await criarLoja(true)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers: { "x-estabelecimento-id": loja.id },
        payload: { emite_nfce: true },
      })

      expect(response.statusCode).toBe(401)
    })

    it("com o switch ligado, produto novo sem NCM/CFOP nasce inativo (RN09.1)", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id)
      await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo/nfce",
        headers,
        payload: { emite_nfce: true },
      })

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers,
        payload: { nome: "Sem Fiscal", preco_custo: 1, preco_venda: 2 },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().ativo).toBe(false)
    })
  })

  describe("GET /estabelecimento/ativo/nfce/pre-check", () => {
    it("200 — loja apta, sem ligar nada", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id, "MANAGER")

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo/nfce/pre-check",
        headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        apto: true,
        plano: "PREMIUM",
        emite_nfce: false,
        pendencias: [],
      })
    })

    it("403 — Caixa não consulta", async () => {
      const loja = await criarLoja(true)
      const headers = await headersDe(loja.id, "CASHIER")

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo/nfce/pre-check",
        headers,
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_NFCE")
    })
  })
})
