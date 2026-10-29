import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { criarAssinatura } from "@/shared/tests/assinatura"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"

async function criarContexto(role: Role = "OWNER") {
  const { user, cookie } = await createAuthenticatedUser()
  const loja = await prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj: CNPJ_VALIDO },
  })
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: loja.id, role },
  })
  return { cookie, lojaId: loja.id, headers: { cookie, "x-estabelecimento-id": loja.id } }
}

describe("GET /billing/planos — E2E (#64 — RF01.1)", () => {
  it("200 — devolve Free e Premium com preços, trial e limites", async () => {
    const { cookie } = await criarContexto()

    const response = await app.inject({ method: "GET", url: "/billing/planos", headers: { cookie } })

    expect(response.statusCode).toBe(200)
    const [free, premium] = response.json().planos
    expect(free).toEqual({
      id: "FREE",
      nome: "Free",
      precos: null,
      trial_dias: null,
      limites: { produtos_ativos: 50, membros: 3, crm_completo: false, nfce: false },
    })
    expect(premium).toEqual({
      id: "PREMIUM",
      nome: "Premium",
      precos: { MENSAL: 30, ANUAL: 299.9 },
      trial_dias: 7,
      limites: { produtos_ativos: null, membros: null, crm_completo: true, nfce: true },
    })
  })

  it("funciona sem loja: dá para ver os planos antes de criar uma", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({ method: "GET", url: "/billing/planos", headers: { cookie } })

    expect(response.statusCode).toBe(200)
  })

  it("401 — sem sessão", async () => {
    const response = await app.inject({ method: "GET", url: "/billing/planos" })

    expect(response.statusCode).toBe(401)
  })
})

describe("GET /billing/assinatura — E2E (#64 — RN00)", () => {
  it("200 — loja sem assinatura é Free, com uso e sem modo restrito", async () => {
    const { headers, lojaId } = await criarContexto()
    await prisma.produto.createMany({
      data: [1, 2].map((n) => ({
        estabelecimento_id: lojaId,
        nome: `P${n}`,
        preco_custo: 1,
        preco_venda: 2,
        quantidade_atual: 1,
      })),
    })

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      plano: "FREE",
      status: null,
      tipo_plano: null,
      trial_expira_em: null,
      limites: { produtos_ativos: 50, membros: 3 },
      uso: { produtos_ativos: 2, membros: 1 },
      modo_restrito: false,
    })
  })

  it("200 — trial é Premium e devolve a data de expiração", async () => {
    const { headers, lojaId } = await criarContexto()
    const trial = new Date("2026-11-05T12:00:00.000Z")
    await prisma.assinatura.create({
      data: { estabelecimento_id: lojaId, status: "TRIALING", trial_expira_em: trial },
    })

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.json()).toMatchObject({
      plano: "PREMIUM",
      status: "TRIALING",
      trial_expira_em: trial.toISOString(),
      limites: { produtos_ativos: null, membros: null, crm_completo: true, nfce: true },
      modo_restrito: false,
    })
  })

  it("200 — assinatura ativa é Premium", async () => {
    const { headers, lojaId } = await criarContexto()
    await criarAssinatura(lojaId, "ACTIVE")

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.json().plano).toBe("PREMIUM")
  })

  it("200 — cancelada com a cota estourada: Free e modo restrito (RN03)", async () => {
    const { headers, lojaId } = await criarContexto()
    await criarAssinatura(lojaId, "CANCELED")
    await prisma.produto.createMany({
      data: Array.from({ length: 55 }, (_, n) => ({
        estabelecimento_id: lojaId,
        nome: `P${n}`,
        preco_custo: 1,
        preco_venda: 2,
        quantidade_atual: 1,
      })),
    })

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.json()).toMatchObject({
      plano: "FREE",
      status: "CANCELED",
      uso: { produtos_ativos: 55 },
      modo_restrito: true,
    })
  })

  it("200 — inadimplente dentro da cota não está em modo restrito", async () => {
    const { headers, lojaId } = await criarContexto()
    await criarAssinatura(lojaId, "PAST_DUE")

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.json()).toMatchObject({ plano: "FREE", status: "PAST_DUE", modo_restrito: false })
  })

  it("200 — o Caixa também consulta o plano", async () => {
    const { headers } = await criarContexto("CASHIER")

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers })

    expect(response.statusCode).toBe(200)
  })

  it("só enxerga a própria loja: assinatura de outra loja não vaza", async () => {
    const dona = await criarContexto()
    await criarAssinatura(dona.lojaId, "ACTIVE")
    const { user, cookie } = await createAuthenticatedUser()
    const outra = await prisma.estabelecimento.create({
      data: { nome: "Outra", cnpj: "11444777000161" },
    })
    await prisma.membroEstabelecimento.create({
      data: { userId: user.id, estabelecimentoId: outra.id, role: "OWNER" },
    })

    const response = await app.inject({
      method: "GET",
      url: "/billing/assinatura",
      headers: { cookie, "x-estabelecimento-id": outra.id },
    })

    expect(response.json().plano).toBe("FREE")
  })

  it("403 — sem vínculo com a loja informada", async () => {
    const dona = await criarContexto()
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "GET",
      url: "/billing/assinatura",
      headers: { cookie, "x-estabelecimento-id": dona.lojaId },
    })

    expect(response.statusCode).toBe(403)
  })

  it("400 — sem o header de loja", async () => {
    const { cookie } = await criarContexto()

    const response = await app.inject({ method: "GET", url: "/billing/assinatura", headers: { cookie } })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
  })

  it("401 — sem sessão", async () => {
    const response = await app.inject({ method: "GET", url: "/billing/assinatura" })

    expect(response.statusCode).toBe(401)
  })
})

describe("limites do Free pela API HTTP — E2E (#68)", () => {
  it("POST /produto — 409 PLANO_LIMITE_PRODUTOS no 51º produto ativo", async () => {
    const { headers, lojaId } = await criarContexto()
    await prisma.produto.createMany({
      data: Array.from({ length: 50 }, (_, n) => ({
        estabelecimento_id: lojaId,
        nome: `P${n}`,
        preco_custo: 1,
        preco_venda: 2,
        quantidade_atual: 1,
      })),
    })

    const response = await app.inject({
      method: "POST",
      url: "/produto",
      headers,
      payload: {
        nome: "51º",
        tipo_medida: "UNIDADE",
        preco_custo: 1,
        preco_venda: 2,
        quantidade_atual: 1,
        quantidade_minima: 0,
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("PLANO_LIMITE_PRODUTOS")
  })

  it("POST /crm/clientes — 409 PLANO_RECURSO_PREMIUM com telefone no Free; sem ele, 201", async () => {
    const { headers } = await criarContexto()

    const bloqueado = await app.inject({
      method: "POST",
      url: "/crm/clientes",
      headers,
      payload: { nome: "Maria Souza", cpf: "529.982.247-25", telefone: "85999990000" },
    })
    expect(bloqueado.statusCode).toBe(409)
    expect(bloqueado.json().code).toBe("PLANO_RECURSO_PREMIUM")

    const liberado = await app.inject({
      method: "POST",
      url: "/crm/clientes",
      headers,
      payload: { nome: "Maria Souza", cpf: "529.982.247-25" },
    })
    expect(liberado.statusCode).toBe(201)
  })

  it("POST /equipe — 409 PLANO_LIMITE_MEMBROS no 4º membro", async () => {
    const { headers, lojaId } = await criarContexto()
    const extras = await Promise.all([createAuthenticatedUser(), createAuthenticatedUser()])
    for (const extra of extras) {
      await prisma.membroEstabelecimento.create({
        data: { userId: extra.user.id, estabelecimentoId: lojaId, role: "CASHIER" },
      })
    }
    const quarto = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/equipe",
      headers,
      payload: { email: quarto.user.email, role: "CASHIER" },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("PLANO_LIMITE_MEMBROS")
  })
})
