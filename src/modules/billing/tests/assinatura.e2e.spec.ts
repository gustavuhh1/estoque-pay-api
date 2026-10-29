import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import {
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { criarAssinatura } from "@/shared/tests/assinatura"
import { errorHandler } from "@/shared/middlewares/error-handler"
import { pagamentoRoutes } from "@/modules/pagamento/routes"
import { InMemoryPagamentoGateway } from "@/modules/pagamento/gateway/InMemoryPagamentoGateway"
import type { Role } from "../../../../generated/prisma/client.js"
import { billingRoutes } from "../routes"
import { InMemoryAssinaturaGateway } from "../gateway/InMemoryAssinaturaGateway"

const CNPJ_VALIDO = "11222333000181"
const SUB = "subs_e2e"
const EM_7_DIAS = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

/**
 * Billing e o webhook (que mora em /pagamento) montados juntos, com os dois
 * gateways dublês: é a jornada inteira da assinatura sem rede e sem chave.
 */
async function montarApp() {
  const assinaturaGateway = new InMemoryAssinaturaGateway()
  const pagamentoGateway = new InMemoryPagamentoGateway()

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  await app.register(billingRoutes(assinaturaGateway), { prefix: "/billing" })
  await app.register(pagamentoRoutes(pagamentoGateway, assinaturaGateway), {
    prefix: "/pagamento",
  })
  await app.ready()

  return { app, assinaturaGateway, pagamentoGateway }
}

async function criarContexto(role: Role = "OWNER", emiteNfce = false) {
  const { user, cookie } = await createAuthenticatedUser()
  const loja = await prisma.estabelecimento.create({
    data: { nome: "Mercearia do Zé", cnpj: CNPJ_VALIDO, emite_nfce: emiteNfce },
  })
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: loja.id, role },
  })
  return { cookie, lojaId: loja.id, headers: { cookie, "x-estabelecimento-id": loja.id } }
}

function webhookDe(evento: string, id = SUB) {
  return JSON.stringify({
    id: `log_${evento}`,
    event: evento,
    apiVersion: 2,
    devMode: true,
    data: { subscription: { id } },
  })
}

async function enviarWebhook(
  app: Awaited<ReturnType<typeof montarApp>>["app"],
  pagamentoGateway: InMemoryPagamentoGateway,
  corpo: string,
  segredoQuery: string | null = pagamentoGateway.segredoQuery
) {
  const query = segredoQuery === null ? "" : `?webhookSecret=${encodeURIComponent(segredoQuery)}`

  return app.inject({
    method: "POST",
    url: `/pagamento/webhook/abacatepay${query}`,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": pagamentoGateway.assinar(corpo),
    },
    payload: corpo,
  })
}

async function planoDa(
  app: Awaited<ReturnType<typeof montarApp>>["app"],
  headers: Record<string, string>
) {
  return (await app.inject({ method: "GET", url: "/billing/assinatura", headers })).json()
}

describe("POST /billing/assinatura — E2E (#65 — RF01.2 / RN04 / D2)", () => {
  it("201 — devolve o checkout do cartão e NÃO ativa nada (RN04)", async () => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "MENSAL" },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      tipo_plano: "MENSAL",
      trial_dias: 7,
      valor: 30,
    })
    expect(response.json().checkout_url).toContain(response.json().checkout_id)
    expect(assinaturaGateway.checkouts).toHaveLength(1)

    // Sem cartão confirmado pela AbacatePay, nem existe Assinatura: segue Free.
    expect(await prisma.assinatura.count()).toBe(0)
    expect((await planoDa(app, ctx.headers)).plano).toBe("FREE")
  })

  it("201 — plano anual", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "ANUAL", metodo_pagamento: "CARTAO" },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ tipo_plano: "ANUAL", valor: 299.9 })
  })

  it("400 — Pix não é aceito para assinatura (D2)", async () => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "MENSAL", metodo_pagamento: "PIX" },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe("VALIDATION_ERROR")
    expect(assinaturaGateway.checkouts).toHaveLength(0)
  })

  it("400 — plano desconhecido", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "TRIMESTRAL" },
    })

    expect(response.statusCode).toBe(400)
  })

  it.each(["MANAGER", "CASHIER"] as const)("403 — %s não contrata", async (role) => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto(role)

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "MENSAL" },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_PLANO")
    expect(assinaturaGateway.checkouts).toHaveLength(0)
  })

  it("409 — trial é um só: loja que já tem assinatura não inicia outro", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    await criarAssinatura(ctx.lojaId, "CANCELED")

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: ctx.headers,
      payload: { tipo_plano: "MENSAL" },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("ASSINATURA_JA_EXISTENTE")
  })

  it("401 — sem sessão", async () => {
    const { app } = await montarApp()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      payload: { tipo_plano: "MENSAL" },
    })

    expect(response.statusCode).toBe(401)
  })

  it("400 — sem o header de loja", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura",
      headers: { cookie: ctx.cookie },
      payload: { tipo_plano: "MENSAL" },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
  })
})

describe("jornada da assinatura pelo webhook — E2E (#65, #66, #67)", () => {
  it("contrata -> trial -> inadimplente -> recupera -> cancela, e a NFC-e acompanha", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto("OWNER", true)

    // 1. Contrata. Loja segue Free.
    const checkout = (
      await app.inject({
        method: "POST",
        url: "/billing/assinatura",
        headers: ctx.headers,
        payload: { tipo_plano: "MENSAL" },
      })
    ).json()
    expect((await planoDa(app, ctx.headers)).plano).toBe("FREE")

    // 2. O cliente paga o cartão no checkout da AbacatePay; ela avisa.
    assinaturaGateway.registrar({
      subscription_id: SUB,
      checkout_id: checkout.checkout_id,
      estabelecimento_id: ctx.lojaId,
      status: "ACTIVE",
      trial_expira_em: EM_7_DIAS,
      tipo_plano: "MENSAL",
    })
    const trial = await enviarWebhook(app, pagamentoGateway, webhookDe("subscription.trial_started"))
    expect(trial.statusCode).toBe(200)
    expect(trial.json()).toEqual({ recebido: true, processado: true })

    const emTrial = await planoDa(app, ctx.headers)
    expect(emTrial).toMatchObject({ plano: "PREMIUM", status: "TRIALING" })
    expect(emTrial.trial_expira_em).toBe(EM_7_DIAS.toISOString())
    expect(emTrial.limites.produtos_ativos).toBeNull()

    // 3. Falha de cobrança: inadimplente. Free, modo restrito e NFC-e desligada.
    await enviarWebhook(app, pagamentoGateway, webhookDe("subscription.payment_failed"))
    expect(await planoDa(app, ctx.headers)).toMatchObject({ plano: "FREE", status: "PAST_DUE" })
    expect(
      (await prisma.estabelecimento.findUniqueOrThrow({ where: { id: ctx.lojaId } })).emite_nfce
    ).toBe(false)

    // 4. Pagamento recuperado.
    assinaturaGateway.definir(SUB, { trial_expira_em: null })
    await enviarWebhook(app, pagamentoGateway, webhookDe("subscription.renewed"))
    expect(await planoDa(app, ctx.headers)).toMatchObject({ plano: "PREMIUM", status: "ACTIVE" })

    // 5. O dono cancela.
    const cancelamento = await app.inject({
      method: "POST",
      url: "/billing/assinatura/cancelar",
      headers: ctx.headers,
    })
    expect(cancelamento.statusCode).toBe(200)
    expect(cancelamento.json()).toMatchObject({ plano: "FREE", status: "CANCELED" })
    expect(assinaturaGateway.canceladas).toEqual([SUB])
  })

  it("o reenvio do mesmo evento responde 200 sem refazer nada", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    assinaturaGateway.registrar({
      subscription_id: SUB,
      estabelecimento_id: ctx.lojaId,
      trial_expira_em: EM_7_DIAS,
    })

    const corpo = webhookDe("subscription.trial_started")
    const primeira = await enviarWebhook(app, pagamentoGateway, corpo)
    const segunda = await enviarWebhook(app, pagamentoGateway, corpo)

    expect(primeira.json().processado).toBe(true)
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().processado).toBe(false)
    expect(await prisma.assinatura.count()).toBe(1)
  })

  it("assinatura cancelada pelo painel da AbacatePay chega por webhook", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto("OWNER", true)
    assinaturaGateway.registrar({
      subscription_id: SUB,
      estabelecimento_id: ctx.lojaId,
      trial_expira_em: null,
    })
    await enviarWebhook(app, pagamentoGateway, webhookDe("subscription.completed"))
    assinaturaGateway.definir(SUB, { status: "CANCELLED" })

    await enviarWebhook(app, pagamentoGateway, webhookDe("subscription.cancelled"))

    expect(await planoDa(app, ctx.headers)).toMatchObject({ plano: "FREE", status: "CANCELED" })
    expect(
      (await prisma.estabelecimento.findUniqueOrThrow({ where: { id: ctx.lojaId } })).emite_nfce
    ).toBe(false)
  })

  it("401 — webhook de assinatura sem o webhookSecret não muda nada", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    assinaturaGateway.registrar({ subscription_id: SUB, estabelecimento_id: ctx.lojaId })

    const response = await enviarWebhook(
      app,
      pagamentoGateway,
      webhookDe("subscription.completed"),
      null
    )

    expect(response.statusCode).toBe(401)
    expect(await prisma.assinatura.count()).toBe(0)
  })

  it("401 — assinatura HMAC inválida", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    assinaturaGateway.registrar({ subscription_id: SUB, estabelecimento_id: ctx.lojaId })
    const corpo = webhookDe("subscription.completed")

    const response = await app.inject({
      method: "POST",
      url: `/pagamento/webhook/abacatepay?webhookSecret=${pagamentoGateway.segredoQuery}`,
      headers: { "content-type": "application/json", "x-webhook-signature": "assinatura-falsa" },
      payload: corpo,
    })

    expect(response.statusCode).toBe(401)
    expect(await prisma.assinatura.count()).toBe(0)
  })

  it("200 processado:false — assinatura de outro sistema na mesma conta", async () => {
    const { app, pagamentoGateway } = await montarApp()

    const response = await enviarWebhook(
      app,
      pagamentoGateway,
      webhookDe("subscription.completed", "subs_de_outro_sistema")
    )

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recebido: true, processado: false })
  })

  it("o id do webhook pode vir no formato data.id", async () => {
    const { app, assinaturaGateway, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    assinaturaGateway.registrar({
      subscription_id: SUB,
      estabelecimento_id: ctx.lojaId,
      trial_expira_em: EM_7_DIAS,
    })
    const corpo = JSON.stringify({
      id: "log_1",
      event: "subscription.trial_started",
      data: { id: SUB },
    })

    const response = await enviarWebhook(app, pagamentoGateway, corpo)

    expect(response.json().processado).toBe(true)
  })

  it("o webhook de Pix continua funcionando na mesma URL", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const corpo = JSON.stringify({
      id: "log_pix",
      event: "transparent.completed",
      data: { id: "pix_char_de_outro_sistema" },
    })

    const response = await enviarWebhook(app, pagamentoGateway, corpo)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recebido: true, processado: false })
  })
})

describe("POST /billing/assinatura/cancelar — E2E (#66)", () => {
  it("200 — cancela e desliga a NFC-e", async () => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto("OWNER", true)
    assinaturaGateway.registrar({ subscription_id: SUB, estabelecimento_id: ctx.lojaId })
    await prisma.assinatura.create({
      data: { estabelecimento_id: ctx.lojaId, status: "ACTIVE", abacatepay_sub_id: SUB },
    })

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura/cancelar",
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ plano: "FREE", status: "CANCELED" })
    expect(
      (await prisma.estabelecimento.findUniqueOrThrow({ where: { id: ctx.lojaId } })).emite_nfce
    ).toBe(false)
  })

  it("404 — loja sem assinatura", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura/cancelar",
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe("ASSINATURA_NAO_ENCONTRADA")
  })

  it("409 — já cancelada", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    await criarAssinatura(ctx.lojaId, "CANCELED")

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura/cancelar",
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("ASSINATURA_JA_CANCELADA")
  })

  it("403 — o Gestor não cancela", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto("MANAGER")
    await criarAssinatura(ctx.lojaId, "ACTIVE")

    const response = await app.inject({
      method: "POST",
      url: "/billing/assinatura/cancelar",
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_PLANO")
  })

  it("401 — sem sessão", async () => {
    const { app } = await montarApp()

    const response = await app.inject({ method: "POST", url: "/billing/assinatura/cancelar" })

    expect(response.statusCode).toBe(401)
  })
})

describe("GET /billing/assinatura — reconciliação do trial vencido (#66)", () => {
  it("trial vencido que ainda é TRIALING é conferido no provedor ao consultar", async () => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto()
    const vencido = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.assinatura.create({
      data: {
        estabelecimento_id: ctx.lojaId,
        status: "TRIALING",
        abacatepay_sub_id: SUB,
        trial_expira_em: vencido,
      },
    })
    // O primeiro débito rolou no provedor e o evento nunca chegou.
    assinaturaGateway.registrar({
      subscription_id: SUB,
      estabelecimento_id: ctx.lojaId,
      status: "ACTIVE",
      trial_expira_em: vencido,
    })

    const corpo = await planoDa(app, ctx.headers)

    expect(corpo).toMatchObject({ plano: "PREMIUM", status: "ACTIVE" })
  })

  it("trial vencido e cancelado no provedor: a consulta já mostra Free", async () => {
    const { app, assinaturaGateway } = await montarApp()
    const ctx = await criarContexto("OWNER", true)
    const vencido = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.assinatura.create({
      data: {
        estabelecimento_id: ctx.lojaId,
        status: "TRIALING",
        abacatepay_sub_id: SUB,
        trial_expira_em: vencido,
      },
    })
    assinaturaGateway.registrar({
      subscription_id: SUB,
      estabelecimento_id: ctx.lojaId,
      status: "CANCELLED",
      trial_expira_em: vencido,
    })

    const corpo = await planoDa(app, ctx.headers)

    expect(corpo).toMatchObject({ plano: "FREE", status: "CANCELED" })
  })
})
