import { describe, it, expect } from "vitest"
import { randomUUID } from "node:crypto"
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
import { InMemoryAssinaturaGateway } from "@/modules/billing/gateway/InMemoryAssinaturaGateway"
import type { Role } from "../../../../generated/prisma/client.js"
import { nfceRoutes } from "../routes"
import { AVISO_SIMULACAO } from "../espelho"

const CNPJ_VALIDO = "11222333000181"
const CNPJ_OUTRA_LOJA = "11444777000161"
const CPF_VALIDO = "52998224725"

async function montarApp() {
  const pagamentoGateway = new InMemoryPagamentoGateway()
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  await app.register(pagamentoRoutes(pagamentoGateway, new InMemoryAssinaturaGateway()), {
    prefix: "/pagamento",
  })
  await app.register(nfceRoutes, { prefix: "/nfce" })
  await app.ready()

  return { app, pagamentoGateway }
}

/** Loja com turno aberto e um produto de R$ 10,00 (saldo 50). Por padrão: Premium, Switch ligado. */
async function criarContexto(
  opcoes: { role?: Role; emiteNfce?: boolean; premium?: boolean; cnpj?: string } = {}
) {
  const { user, cookie } = await createAuthenticatedUser()
  const loja = await prisma.estabelecimento.create({
    data: {
      nome: "Mercearia do Zé",
      cnpj: opcoes.cnpj ?? CNPJ_VALIDO,
      ie: "123456789",
      emite_nfce: opcoes.emiteNfce ?? true,
    },
  })
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: loja.id, role: opcoes.role ?? "OWNER" },
  })
  await prisma.turnoCaixa.create({
    data: { estabelecimento_id: loja.id, aberto_por_id: user.id, valor_abertura: 100 },
  })
  if (opcoes.premium !== false) {
    await criarAssinatura(loja.id, "ACTIVE")
  }
  const produto = await prisma.produto.create({
    data: {
      estabelecimento_id: loja.id,
      nome: "Queijo Minas",
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 50,
      quantidade_minima: 0,
    },
  })

  return {
    user,
    cookie,
    lojaId: loja.id,
    produtoId: produto.id,
    headers: { cookie, "x-estabelecimento-id": loja.id },
  }
}

type Ctx = Awaited<ReturnType<typeof criarContexto>>
type App = Awaited<ReturnType<typeof montarApp>>["app"]

async function pagarEmDinheiro(app: App, ctx: Ctx, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/pagamento",
    headers: ctx.headers,
    payload: {
      itens: [{ produto_id: ctx.produtoId, quantidade: 2 }],
      metodo_pagamento: "DINHEIRO",
      valor_pago: 100,
      ...extra,
    },
  })
}

async function iniciarPix(app: App, ctx: Ctx, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/pagamento/pix",
    headers: ctx.headers,
    payload: { itens: [{ produto_id: ctx.produtoId, quantidade: 2 }], ...extra },
  })
}

const consultar = (app: App, ctx: Ctx, vendaId: string) =>
  app.inject({ method: "GET", url: `/nfce/vendas/${vendaId}`, headers: ctx.headers })

describe("NFC-e simulada após a venda paga — E2E (#81 — D3)", () => {
  it("dinheiro: a venda paga gera a nota sozinha, com o aviso de simulação", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const venda = (await pagarEmDinheiro(app, ctx)).json()
    const resposta = await consultar(app, ctx, venda.venda_id)

    expect(resposta.statusCode).toBe(200)
    const nota = resposta.json()
    expect(nota).toMatchObject({ venda_id: venda.venda_id, numero: 1, status: "AUTORIZADA" })
    expect(nota.espelho).toMatchObject({
      simulada: true,
      aviso: AVISO_SIMULACAO,
      forma_pagamento: "DINHEIRO",
      subtotal_itens: 20,
      total_venda: 20,
      total_cobrado: 20,
      taxa_pix: null,
      estabelecimento: { nome: "Mercearia do Zé", cnpj: CNPJ_VALIDO, ie: "123456789" },
      consumidor: { identificado: false, nome: null, cpf: null },
    })
    expect(nota.espelho.itens).toEqual([
      { nome: "Queijo Minas", quantidade: 2, preco_unitario: 10, total: 20 },
    ])
    expect(nota.espelho.chave_de_acesso).toMatch(/^SIMULADO\d{36}$/)
  })

  it("cartão: gera nota sem taxa", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const venda = (
      await pagarEmDinheiro(app, ctx, { metodo_pagamento: "CREDITO", valor_pago: undefined })
    ).json()
    const nota = (await consultar(app, ctx, venda.venda_id)).json()

    expect(nota.espelho.forma_pagamento).toBe("CREDITO")
    expect(nota.espelho.taxa_pix).toBeNull()
  })

  it("com cliente identificado: a nota leva o nome e o CPF (RN03 da Fase 4)", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    await prisma.assinatura.update({ where: { estabelecimento_id: ctx.lojaId }, data: {} })
    const cliente = await prisma.cliente.create({
      data: { estabelecimento_id: ctx.lojaId, nome: "Maria Souza", cpf: CPF_VALIDO },
    })

    const venda = (await pagarEmDinheiro(app, ctx, { cliente_id: cliente.id })).json()
    const nota = (await consultar(app, ctx, venda.venda_id)).json()

    expect(nota.espelho.consumidor).toEqual({
      identificado: true,
      nome: "Maria Souza",
      cpf: CPF_VALIDO,
    })
  })

  it("cupom: o desconto aparece na nota", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    await prisma.cupom.create({
      data: { estabelecimento_id: ctx.lojaId, codigo: "DEZ5", valor_desconto: 5 },
    })

    const venda = (await pagarEmDinheiro(app, ctx, { cupom_codigo: "DEZ5" })).json()
    const { espelho } = (await consultar(app, ctx, venda.venda_id)).json()

    expect(espelho).toMatchObject({ subtotal_itens: 20, desconto: 5, total_venda: 15, total_cobrado: 15 })
  })

  it("PIX (D1): a nota discrimina a taxa de R$ 0,80 e o total pago = itens + taxa", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()

    // Antes do pagamento ainda não há nota.
    expect((await consultar(app, ctx, pix.venda_id)).statusCode).toBe(404)

    pagamentoGateway.definirStatus(pix.payment_id, "PAID")
    await app.inject({
      method: "GET",
      url: `/pagamento/pix/${pix.payment_id}/status`,
      headers: ctx.headers,
    })

    const { espelho } = (await consultar(app, ctx, pix.venda_id)).json()
    expect(espelho).toMatchObject({
      forma_pagamento: "PIX",
      subtotal_itens: 20,
      total_venda: 20,
      taxa_pix: 0.8,
      total_cobrado: 20.8,
    })
  })

  it("PIX: polling repetido não duplica a nota nem gasta número", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()
    pagamentoGateway.definirStatus(pix.payment_id, "PAID")

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "GET",
        url: `/pagamento/pix/${pix.payment_id}/status`,
        headers: ctx.headers,
      })
    }
    const proxima = (await pagarEmDinheiro(app, ctx)).json()

    expect(await prisma.venda.count({ where: { nfe_numero: { not: null } } })).toBe(2)
    expect((await consultar(app, ctx, proxima.venda_id)).json().numero).toBe(2)
  })

  it("PIX confirmado pelo webhook também gera a nota", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()
    pagamentoGateway.definirStatus(pix.payment_id, "PAID")
    const corpo = JSON.stringify({
      id: "log_1",
      event: "transparent.completed",
      data: { id: pix.payment_id },
    })

    await app.inject({
      method: "POST",
      url: `/pagamento/webhook/abacatepay?webhookSecret=${pagamentoGateway.segredoQuery}`,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": pagamentoGateway.assinar(corpo),
      },
      payload: corpo,
    })

    const nota = (await consultar(app, ctx, pix.venda_id)).json()
    expect(nota.espelho.taxa_pix).toBe(0.8)
  })

  it("Pix expirado (venda cancelada) não gera nota", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()
    pagamentoGateway.definirStatus(pix.payment_id, "EXPIRED")
    await app.inject({
      method: "GET",
      url: `/pagamento/pix/${pix.payment_id}/status`,
      headers: ctx.headers,
    })

    expect(await prisma.venda.count({ where: { nfe_numero: { not: null } } })).toBe(0)
  })

  it("Switch Fiscal desligado: a venda fecha e não há nota", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ emiteNfce: false })

    const venda = await pagarEmDinheiro(app, ctx)

    expect(venda.statusCode).toBe(201)
    expect((await consultar(app, ctx, venda.json().venda_id)).statusCode).toBe(404)
  })

  it("plano Free: a venda fecha e não há nota, mesmo com o Switch ligado no banco", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ premium: false })

    const venda = await pagarEmDinheiro(app, ctx)

    expect(venda.statusCode).toBe(201)
    expect((await consultar(app, ctx, venda.json().venda_id)).statusCode).toBe(404)
    expect(await prisma.venda.count({ where: { nfe_numero: { not: null } } })).toBe(0)
  })

  it("a numeração é sequencial e SEM buracos mesmo com vendas simultâneas", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const respostas = await Promise.all(
      Array.from({ length: 6 }, () => pagarEmDinheiro(app, ctx))
    )
    expect(respostas.every((r) => r.statusCode === 201)).toBe(true)

    const numeros = (
      await prisma.venda.findMany({
        where: { estabelecimento_id: ctx.lojaId, nfe_numero: { not: null } },
        select: { nfe_numero: true },
      })
    )
      .map((v) => v.nfe_numero as number)
      .sort((a, b) => a - b)
    expect(numeros).toEqual([1, 2, 3, 4, 5, 6])

    const loja = await prisma.estabelecimento.findUniqueOrThrow({ where: { id: ctx.lojaId } })
    expect(loja.nfce_ultimo_numero).toBe(6)
  })
})

describe("GET /nfce e impressão — E2E (#81)", () => {
  it("lista só as notas da loja ativa, da mais nova para a mais antiga, com a marca de simulação", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    const outra = await criarContexto({ cnpj: CNPJ_OUTRA_LOJA })
    await pagarEmDinheiro(app, ctx)
    await pagarEmDinheiro(app, ctx)
    await pagarEmDinheiro(app, outra)

    const resposta = await app.inject({ method: "GET", url: "/nfce", headers: ctx.headers })

    expect(resposta.statusCode).toBe(200)
    const corpo = resposta.json()
    expect(corpo.total).toBe(2)
    expect(corpo.data.map((n: { numero: number }) => n.numero)).toEqual([2, 1])
    expect(corpo.data[0]).toMatchObject({
      simulada: true,
      aviso: AVISO_SIMULACAO,
      forma_pagamento: "DINHEIRO",
      total_cobrado: 20,
      consumidor_identificado: false,
    })
  })

  it("paginação", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    for (let i = 0; i < 3; i++) await pagarEmDinheiro(app, ctx)

    const pagina = (
      await app.inject({ method: "GET", url: "/nfce?page=2&limit=2", headers: ctx.headers })
    ).json()

    expect(pagina).toMatchObject({ total: 3, page: 2, limit: 2 })
    expect(pagina.data).toHaveLength(1)
  })

  it("400 — limit acima do teto", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const resposta = await app.inject({ method: "GET", url: "/nfce?limit=1000", headers: ctx.headers })

    expect(resposta.statusCode).toBe(400)
  })

  it("imprimir devolve HTML com o aviso e cabeçalhos de segurança", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const resposta = await app.inject({
      method: "GET",
      url: `/nfce/vendas/${venda.venda_id}/imprimir`,
      headers: ctx.headers,
    })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.headers["content-type"]).toContain("text/html")
    expect(resposta.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(resposta.headers["cache-control"]).toBe("no-store")
    expect(resposta.body.split(AVISO_SIMULACAO).length - 1).toBeGreaterThanOrEqual(2)
    expect(resposta.body).toContain("Mercearia do Zé")
    expect(resposta.body).toContain("Consumidor Não Identificado")
  })

  it("imprimir uma venda Pix mostra a linha da taxa", async () => {
    const { app, pagamentoGateway } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()
    pagamentoGateway.definirStatus(pix.payment_id, "PAID")
    await app.inject({
      method: "GET",
      url: `/pagamento/pix/${pix.payment_id}/status`,
      headers: ctx.headers,
    })

    const resposta = await app.inject({
      method: "GET",
      url: `/nfce/vendas/${pix.venda_id}/imprimir`,
      headers: ctx.headers,
    })

    expect(resposta.body).toContain("Taxa de serviço Pix")
    expect(resposta.body).toMatch(/TOTAL PAGO[\s\S]*20,80/)
  })

  it("nome de produto malicioso não vira HTML executável na impressão", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    await prisma.produto.update({
      where: { id: ctx.produtoId },
      data: { nome: "<script>alert(1)</script>" },
    })
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const resposta = await app.inject({
      method: "GET",
      url: `/nfce/vendas/${venda.venda_id}/imprimir`,
      headers: ctx.headers,
    })

    expect(resposta.body).not.toContain("<script>alert(1)")
    expect(resposta.body).toContain("&lt;script&gt;")
  })

  it("o Caixa consulta e imprime (é quem entrega a via no balcão)", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ role: "CASHIER" })
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const consulta = await consultar(app, ctx, venda.venda_id)
    const impressao = await app.inject({
      method: "GET",
      url: `/nfce/vendas/${venda.venda_id}/imprimir`,
      headers: ctx.headers,
    })

    expect(consulta.statusCode).toBe(200)
    expect(impressao.statusCode).toBe(200)
  })

  it("nota de outra loja é 404, na consulta e na impressão", async () => {
    const { app } = await montarApp()
    const dona = await criarContexto()
    const intrusa = await criarContexto({ cnpj: CNPJ_OUTRA_LOJA })
    const venda = (await pagarEmDinheiro(app, dona)).json()

    const consulta = await consultar(app, intrusa, venda.venda_id)
    const impressao = await app.inject({
      method: "GET",
      url: `/nfce/vendas/${venda.venda_id}/imprimir`,
      headers: intrusa.headers,
    })

    expect(consulta.statusCode).toBe(404)
    expect(consulta.json().code).toBe("NFCE_NAO_ENCONTRADA")
    expect(impressao.statusCode).toBe(404)
  })

  it("a nota emitida continua acessível depois que a loja é rebaixada e o Switch desligado", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    const venda = (await pagarEmDinheiro(app, ctx)).json()
    await prisma.assinatura.update({
      where: { estabelecimento_id: ctx.lojaId },
      data: { status: "CANCELED" },
    })
    await prisma.estabelecimento.update({ where: { id: ctx.lojaId }, data: { emite_nfce: false } })

    expect((await consultar(app, ctx, venda.venda_id)).statusCode).toBe(200)
    expect(
      (await app.inject({ method: "GET", url: "/nfce", headers: ctx.headers })).json().total
    ).toBe(1)
  })

  it("401 — sem sessão", async () => {
    const { app } = await montarApp()

    for (const url of ["/nfce", `/nfce/vendas/${randomUUID()}`]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401)
    }
  })

  it("400 — sem o header de loja, e id que não é UUID", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()

    const semHeader = await app.inject({ method: "GET", url: "/nfce", headers: { cookie: ctx.cookie } })
    const idRuim = await app.inject({ method: "GET", url: "/nfce/vendas/abc", headers: ctx.headers })

    expect(semHeader.statusCode).toBe(400)
    expect(semHeader.json().code).toBe("TENANT_HEADER_REQUIRED")
    expect(idRuim.statusCode).toBe(400)
  })
})

describe("POST /nfce/vendas/:venda_id/emitir — E2E (#81)", () => {
  it("venda paga ANTES de o Switch ser ligado: o Owner emite depois (201) e repetir devolve a mesma (200)", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ emiteNfce: false })
    const venda = (await pagarEmDinheiro(app, ctx)).json()
    await prisma.estabelecimento.update({ where: { id: ctx.lojaId }, data: { emite_nfce: true } })

    const primeira = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })
    const segunda = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(primeira.statusCode).toBe(201)
    expect(primeira.json().espelho.aviso).toBe(AVISO_SIMULACAO)
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().numero).toBe(primeira.json().numero)
  })

  it("o Gestor emite", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ role: "MANAGER", emiteNfce: false })
    const venda = (await pagarEmDinheiro(app, ctx)).json()
    await prisma.estabelecimento.update({ where: { id: ctx.lojaId }, data: { emite_nfce: true } })

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(resposta.statusCode).toBe(201)
  })

  it("403 — o Caixa não reemite", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ role: "CASHIER" })
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json().code).toBe("ROLE_CANNOT_EMIT_NFCE")
  })

  it("409 — Pix ainda pendente: VENDA_NAO_PAGA", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto()
    const pix = (await iniciarPix(app, ctx)).json()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${pix.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json()).toMatchObject({
      code: "NFCE_NAO_ELEGIVEL",
      details: { motivo: "VENDA_NAO_PAGA" },
    })
  })

  it("409 — Switch desligado: SWITCH_DESLIGADO", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ emiteNfce: false })
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(resposta.json().details.motivo).toBe("SWITCH_DESLIGADO")
  })

  it("409 — plano Free: PLANO_FREE", async () => {
    const { app } = await montarApp()
    const ctx = await criarContexto({ premium: false })
    const venda = (await pagarEmDinheiro(app, ctx)).json()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: ctx.headers,
    })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json().details.motivo).toBe("PLANO_FREE")
  })

  it("404 — venda de outra loja", async () => {
    const { app } = await montarApp()
    const dona = await criarContexto()
    const intrusa = await criarContexto({ cnpj: CNPJ_OUTRA_LOJA })
    const venda = (await pagarEmDinheiro(app, dona)).json()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${venda.venda_id}/emitir`,
      headers: intrusa.headers,
    })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json().code).toBe("VENDA_NAO_ENCONTRADA")
  })

  it("401 — sem sessão", async () => {
    const { app } = await montarApp()

    const resposta = await app.inject({
      method: "POST",
      url: `/nfce/vendas/${randomUUID()}/emitir`,
    })

    expect(resposta.statusCode).toBe(401)
  })
})
