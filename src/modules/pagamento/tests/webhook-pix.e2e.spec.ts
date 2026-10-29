import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/prisma"
import { InMemoryPagamentoGateway } from "../gateway/InMemoryPagamentoGateway"
import { criarContexto, estoqueDe, iniciarPix, montarApp } from "./pix-helpers"

/**
 * #79 — o webhook consolida a venda Pix. Usa o gateway dublê (que assina e
 * valida igual ao real) para controlar o que o "provedor" responde na consulta
 * de confirmação.
 */
function corpoPago(paymentId: string, formato: "id" | "transparent" = "id") {
  return JSON.stringify({
    id: "log_evento_1",
    event: "transparent.completed",
    apiVersion: 2,
    devMode: true,
    data: formato === "id" ? { id: paymentId } : { transparent: { id: paymentId } },
  })
}

async function enviar(
  app: Awaited<ReturnType<typeof montarApp>>,
  gateway: InMemoryPagamentoGateway,
  corpo: string,
  segredoQuery: string | null = gateway.segredoQuery
) {
  const query = segredoQuery === null ? "" : `?webhookSecret=${encodeURIComponent(segredoQuery)}`

  return app.inject({
    method: "POST",
    url: `/pagamento/webhook/abacatepay${query}`,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": gateway.assinar(corpo),
    },
    payload: corpo,
  })
}

async function cenarioPendente(quantidade = 2) {
  const gateway = new InMemoryPagamentoGateway()
  const app = await montarApp(gateway)
  const ctx = await criarContexto()
  const { payment_id, venda_id } = (
    await iniciarPix(app, ctx, { itens: [{ produto_id: ctx.produtoId, quantidade }] })
  ).json()

  return { gateway, app, ctx, paymentId: payment_id as string, vendaId: venda_id as string }
}

describe("POST /pagamento/webhook/abacatepay — consolidação do Pix (#79)", () => {
  it("consolida: venda PAGO, estoque baixado e movimentação VENDA", async () => {
    const { gateway, app, ctx, paymentId, vendaId } = await cenarioPendente(3)
    gateway.definirStatus(paymentId, "PAID")

    const response = await enviar(app, gateway, corpoPago(paymentId))

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recebido: true, processado: true })

    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })
    expect(venda.status_pagamento).toBe("PAGO")
    expect(venda.pago_em).toBeInstanceOf(Date)
    expect(Number(venda.taxa_split)).toBe(0.8)

    expect(await estoqueDe(ctx.produtoId)).toBe(7)
    const movimentacoes = await prisma.movimentacaoEstoque.findMany()
    expect(movimentacoes).toHaveLength(1)
    expect(movimentacoes[0]?.motivo).toBe("VENDA")
  })

  it("acha a cobrança também quando o id vem em data.transparent.id", async () => {
    const { gateway, app, paymentId, vendaId } = await cenarioPendente()
    gateway.definirStatus(paymentId, "PAID")

    const response = await enviar(app, gateway, corpoPago(paymentId, "transparent"))

    expect(response.json().processado).toBe(true)
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })
    expect(venda.status_pagamento).toBe("PAGO")
  })

  it("IDEMPOTÊNCIA: o provedor reenvia o mesmo evento e o estoque só baixa uma vez", async () => {
    const { gateway, app, ctx, paymentId } = await cenarioPendente(2)
    gateway.definirStatus(paymentId, "PAID")
    const corpo = corpoPago(paymentId)

    const primeira = await enviar(app, gateway, corpo)
    const segunda = await enviar(app, gateway, corpo)
    const terceira = await enviar(app, gateway, corpo)

    expect(primeira.json().processado).toBe(true)
    // Reenvio: 200 sem fazer nada, não erro (erro faria o provedor insistir).
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json()).toEqual({ recebido: true, processado: false })
    expect(terceira.json().processado).toBe(false)

    expect(await estoqueDe(ctx.produtoId)).toBe(8)
    expect(await prisma.movimentacaoEstoque.count()).toBe(1)
  })

  it("IDEMPOTÊNCIA sob corrida: entregas simultâneas do mesmo evento baixam uma vez só", async () => {
    const { gateway, app, ctx, paymentId } = await cenarioPendente(2)
    gateway.definirStatus(paymentId, "PAID")
    const corpo = corpoPago(paymentId)

    const respostas = await Promise.all([
      enviar(app, gateway, corpo),
      enviar(app, gateway, corpo),
      enviar(app, gateway, corpo),
    ])

    expect(respostas.every((r) => r.statusCode === 200)).toBe(true)
    // Exatamente uma consolidou.
    expect(respostas.filter((r) => r.json().processado).length).toBe(1)
    expect(await estoqueDe(ctx.produtoId)).toBe(8)
    expect(await prisma.movimentacaoEstoque.count()).toBe(1)
  })

  it("webhook + polling juntos também não baixam em dobro", async () => {
    const { gateway, app, ctx, paymentId } = await cenarioPendente(2)
    gateway.definirStatus(paymentId, "PAID")

    await Promise.all([
      enviar(app, gateway, corpoPago(paymentId)),
      app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers: ctx.headers,
      }),
    ])

    expect(await estoqueDe(ctx.produtoId)).toBe(8)
    expect(await prisma.movimentacaoEstoque.count()).toBe(1)
  })

  it("o evento é só gatilho: se o provedor NÃO confirma PAID, nada é consolidado", async () => {
    // Payload autenticado mas "mentiroso" (ou evento adiantado): a baixa de
    // estoque não pode depender do que o corpo diz.
    const { gateway, app, ctx, paymentId, vendaId } = await cenarioPendente()
    // O gateway segue PENDING.

    const response = await enviar(app, gateway, corpoPago(paymentId))

    expect(response.statusCode).toBe(200)
    expect(response.json().processado).toBe(false)
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })
    expect(venda.status_pagamento).toBe("PENDENTE")
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
  })

  it("200 processado:false — cobrança que não é de nenhuma venda nossa", async () => {
    const { gateway, app } = await cenarioPendente()

    const response = await enviar(app, gateway, corpoPago("pix_char_de_outro_sistema"))

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recebido: true, processado: false })
  })

  it("evento sem id na data não quebra", async () => {
    const { gateway, app } = await cenarioPendente()
    const corpo = JSON.stringify({ id: "log_2", event: "transparent.completed", data: {} })

    const response = await enviar(app, gateway, corpo)

    expect(response.statusCode).toBe(200)
    expect(response.json().processado).toBe(false)
  })

  it("não reabre uma venda já cancelada: pagamento tardio de venda CANCELADA é ignorado", async () => {
    const { gateway, app, ctx, paymentId, vendaId } = await cenarioPendente()
    gateway.definirStatus(paymentId, "EXPIRED")
    await app.inject({
      method: "GET",
      url: `/pagamento/pix/${paymentId}/status`,
      headers: ctx.headers,
    })
    // O provedor "muda de ideia" depois que o PDV já cancelou a venda.
    gateway.definirStatus(paymentId, "PAID")

    const response = await enviar(app, gateway, corpoPago(paymentId))

    expect(response.json().processado).toBe(false)
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })
    expect(venda.status_pagamento).toBe("CANCELADO")
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
  })

  it("401 — sem webhookSecret na query, e nada é consolidado", async () => {
    const { gateway, app, ctx, paymentId } = await cenarioPendente()
    gateway.definirStatus(paymentId, "PAID")

    const response = await enviar(app, gateway, corpoPago(paymentId), null)

    expect(response.statusCode).toBe(401)
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
  })

  it("401 — webhookSecret errado na query, e nada é consolidado", async () => {
    const { gateway, app, ctx, paymentId } = await cenarioPendente()
    gateway.definirStatus(paymentId, "PAID")

    const response = await enviar(app, gateway, corpoPago(paymentId), "segredo-errado")

    expect(response.statusCode).toBe(401)
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
  })
})
