import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/prisma"
import { InMemoryPagamentoGateway } from "../gateway/InMemoryPagamentoGateway"
import type { CriarCobrancaPixParams } from "../gateway/IPagamentoGateway"
import {
  CNPJ_OUTRA_LOJA,
  criarContexto,
  estoqueDe,
  iniciarPix,
  montarApp,
} from "./pix-helpers"

describe("POST /pagamento/pix — E2E (#52, D1)", () => {
  it("201 — cobra itens + R$ 0,80, grava a venda PENDENTE e NÃO baixa estoque", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()

    const response = await iniciarPix(app, ctx, { itens: [{ produto_id: ctx.produtoId, quantidade: 2 }] })

    expect(response.statusCode).toBe(201)
    const corpo = response.json()
    expect(corpo.total_venda).toBe(20.14)
    expect(corpo.taxa_pix).toBe(0.8)
    expect(corpo.total_cobrado).toBe(20.94)
    expect(corpo.status_pagamento).toBe("PENDENTE")
    expect(corpo.qr_code).toBeTruthy()
    expect(corpo.qr_code_imagem).toBeTruthy()

    // O QR Code sai com o valor COM a taxa.
    expect(gateway.cobrancas).toHaveLength(1)
    expect(gateway.cobrancas[0]?.valor).toBe(20.94)
    expect(gateway.cobrancas[0]?.venda_id).toBe(corpo.venda_id)

    // Registro da venda: itens em total_venda, taxa em taxa_split.
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: corpo.venda_id } })
    expect(venda.status_pagamento).toBe("PENDENTE")
    expect(venda.metodo_pagamento).toBe("PIX_ABACATEPAY")
    expect(Number(venda.total_venda)).toBe(20.14)
    expect(Number(venda.taxa_split)).toBe(0.8)
    expect(venda.abacatepay_payment_id).toBe(corpo.payment_id)
    expect(venda.pago_em).toBeNull()

    // RN01: carrinho/venda pendente não mexe no estoque.
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
    expect(await prisma.movimentacaoEstoque.count()).toBe(0)
  })

  it("a soma da taxa não propaga erro de float (10.07 + 0.8 = 10.87)", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()

    const response = await iniciarPix(app, ctx)

    expect(response.json().total_cobrado).toBe(10.87)
    expect(gateway.cobrancas[0]?.valor).toBe(10.87)
  })

  it("com cupom: o desconto sai dos itens e a taxa é somada depois", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()
    await prisma.cupom.create({
      data: { estabelecimento_id: ctx.lojaId, codigo: "PIX5", valor_desconto: 5 },
    })

    const response = await iniciarPix(app, ctx, { cupom_codigo: "PIX5" })

    expect(response.statusCode).toBe(201)
    const corpo = response.json()
    expect(corpo.desconto).toBe(5)
    expect(corpo.total_venda).toBe(5.07)
    expect(corpo.total_cobrado).toBe(5.87)

    // O cupom fica consumido já na criação: um 2º Pix não pode usá-lo.
    const segundo = await iniciarPix(app, ctx, { cupom_codigo: "PIX5" })
    expect(segundo.statusCode).toBe(409)
    expect(segundo.json().code).toBe("CUPOM_JA_RESGATADO")
  })

  it("409 — caixa fechado", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto({ turnoAberto: false })

    const response = await iniciarPix(app, ctx)

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("TURNO_FECHADO")
    expect(gateway.cobrancas).toHaveLength(0)
  })

  it("se o provedor recusa a cobrança, não sobra venda nem cupom consumido", async () => {
    class GatewayQueFalha extends InMemoryPagamentoGateway {
      override async criarCobrancaPix(_params: CriarCobrancaPixParams): Promise<never> {
        throw new Error("provedor fora do ar")
      }
    }
    const app = await montarApp(new GatewayQueFalha())
    const ctx = await criarContexto()
    await prisma.cupom.create({
      data: { estabelecimento_id: ctx.lojaId, codigo: "PIX5", valor_desconto: 5 },
    })

    const response = await iniciarPix(app, ctx, { cupom_codigo: "PIX5" })

    expect(response.statusCode).toBe(500)
    expect(await prisma.venda.count()).toBe(0)
    const cupom = await prisma.cupom.findFirstOrThrow({ where: { codigo: "PIX5" } })
    expect(cupom.resgatado_em).toBeNull()
  })

  it("400 — carrinho vazio", async () => {
    const app = await montarApp(new InMemoryPagamentoGateway())
    const ctx = await criarContexto()

    const response = await iniciarPix(app, ctx, { itens: [] })

    expect(response.statusCode).toBe(400)
  })

  it("401 — sem sessão", async () => {
    const app = await montarApp(new InMemoryPagamentoGateway())

    const response = await app.inject({
      method: "POST",
      url: "/pagamento/pix",
      payload: { itens: [{ produto_id: "00000000-0000-0000-0000-000000000000", quantidade: 1 }] },
    })

    expect(response.statusCode).toBe(401)
  })
})

describe("GET /pagamento/pix/:payment_id/status — E2E (#52)", () => {
  it("200 — PENDING antes do pagamento, venda PENDENTE e estoque intacto", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()
    const { payment_id, venda_id } = (await iniciarPix(app, ctx)).json()

    const response = await app.inject({
      method: "GET",
      url: `/pagamento/pix/${payment_id}/status`,
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe("PENDING")
    expect(response.json().pago).toBe(false)
    expect(response.json().venda_id).toBe(venda_id)
    expect(response.json().status_pagamento).toBe("PENDENTE")
    expect(response.json().total_cobrado).toBe(10.87)
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
  })

  it("consolida quando o provedor confirma: PAGO + baixa de estoque, uma única vez", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()
    const { payment_id } = (
      await iniciarPix(app, ctx, { itens: [{ produto_id: ctx.produtoId, quantidade: 3 }] })
    ).json()
    gateway.definirStatus(payment_id, "PAID")

    const consultar = () =>
      app.inject({
        method: "GET",
        url: `/pagamento/pix/${payment_id}/status`,
        headers: ctx.headers,
      })

    const primeira = await consultar()
    expect(primeira.json().pago).toBe(true)
    expect(primeira.json().status_pagamento).toBe("PAGO")
    expect(await estoqueDe(ctx.produtoId)).toBe(7)

    // Polling a cada poucos segundos: consultar de novo NÃO baixa outra vez.
    await consultar()
    await consultar()
    expect(await estoqueDe(ctx.produtoId)).toBe(7)

    const movimentacoes = await prisma.movimentacaoEstoque.findMany()
    expect(movimentacoes).toHaveLength(1)
    expect(movimentacoes[0]?.motivo).toBe("VENDA")
    expect(movimentacoes[0]?.tipo).toBe("SAIDA")

    const venda = await prisma.venda.findFirstOrThrow()
    expect(venda.status_pagamento).toBe("PAGO")
    expect(venda.pago_em).toBeInstanceOf(Date)
  })

  it("cobrança expirada cancela a venda PENDENTE e devolve o cupom, sem tocar no estoque", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()
    await prisma.cupom.create({
      data: { estabelecimento_id: ctx.lojaId, codigo: "PIX5", valor_desconto: 5 },
    })
    const { payment_id } = (await iniciarPix(app, ctx, { cupom_codigo: "PIX5" })).json()
    gateway.definirStatus(payment_id, "EXPIRED")

    const response = await app.inject({
      method: "GET",
      url: `/pagamento/pix/${payment_id}/status`,
      headers: ctx.headers,
    })

    expect(response.json().status).toBe("EXPIRED")
    expect(response.json().status_pagamento).toBe("CANCELADO")
    expect(await estoqueDe(ctx.produtoId)).toBe(10)
    expect(await prisma.movimentacaoEstoque.count()).toBe(0)

    const cupom = await prisma.cupom.findFirstOrThrow({ where: { codigo: "PIX5" } })
    expect(cupom.resgatado_em).toBeNull()
    expect(cupom.venda_id).toBeNull()
  })

  it("404 — cobrança de outra loja é indistinguível de inexistente", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const dona = await criarContexto()
    const intrusa = await criarContexto({ cnpj: CNPJ_OUTRA_LOJA })
    const { payment_id } = (await iniciarPix(app, dona)).json()

    const response = await app.inject({
      method: "GET",
      url: `/pagamento/pix/${payment_id}/status`,
      headers: intrusa.headers,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe("COBRANCA_NAO_ENCONTRADA")
  })

  it("404 — payment_id que não é de nenhuma venda", async () => {
    const app = await montarApp(new InMemoryPagamentoGateway())
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "GET",
      url: "/pagamento/pix/pix_char_inexistente/status",
      headers: ctx.headers,
    })

    expect(response.statusCode).toBe(404)
  })

  it("401 — sem sessão", async () => {
    const app = await montarApp(new InMemoryPagamentoGateway())

    const response = await app.inject({
      method: "GET",
      url: "/pagamento/pix/pix_char_x/status",
    })

    expect(response.statusCode).toBe(401)
  })

  it("400 — sem o header de loja", async () => {
    const app = await montarApp(new InMemoryPagamentoGateway())
    const ctx = await criarContexto()

    const response = await app.inject({
      method: "GET",
      url: "/pagamento/pix/pix_char_x/status",
      headers: { cookie: ctx.cookie },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
  })
})

describe("POST /pagamento/pix/:payment_id/simular-pagamento — E2E (#52)", () => {
  it("200 — simula e consolida a venda (PAGO + baixa de estoque)", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const ctx = await criarContexto()
    const { payment_id } = (await iniciarPix(app, ctx)).json()

    const simulacao = await app.inject({
      method: "POST",
      url: `/pagamento/pix/${payment_id}/simular-pagamento`,
      headers: ctx.headers,
    })

    expect(simulacao.statusCode).toBe(200)
    expect(simulacao.json().pago).toBe(true)
    expect(simulacao.json().status_pagamento).toBe("PAGO")
    expect(await estoqueDe(ctx.produtoId)).toBe(9)
  })

  it("404 — não simula cobrança de outra loja", async () => {
    const gateway = new InMemoryPagamentoGateway()
    const app = await montarApp(gateway)
    const dona = await criarContexto()
    const intrusa = await criarContexto({ cnpj: CNPJ_OUTRA_LOJA })
    const { payment_id } = (await iniciarPix(app, dona)).json()

    const simulacao = await app.inject({
      method: "POST",
      url: `/pagamento/pix/${payment_id}/simular-pagamento`,
      headers: intrusa.headers,
    })

    expect(simulacao.statusCode).toBe(404)
    expect(await estoqueDe(dona.produtoId)).toBe(10)
  })

  it("NÃO é registrada quando NODE_ENV=production", async () => {
    // A trava que impede a rota de existir em produção mesmo se alguém
    // esquecer de comentar o bloco ao mesclar para a main.
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = "production"

    try {
      const app = await montarApp(new InMemoryPagamentoGateway())
      const ctx = await criarContexto()

      const response = await app.inject({
        method: "POST",
        url: "/pagamento/pix/pix_char_x/simular-pagamento",
        headers: ctx.headers,
      })

      expect(response.statusCode).toBe(404)
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it("em produção só existe com o opt-in PAGAMENTO_SIMULACAO_HABILITADA=true (AbacatePay em modo Dev)", async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    process.env.PAGAMENTO_SIMULACAO_HABILITADA = "true"

    try {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const ctx = await criarContexto()
      const { payment_id } = (await iniciarPix(app, ctx)).json()

      const response = await app.inject({
        method: "POST",
        url: `/pagamento/pix/${payment_id}/simular-pagamento`,
        headers: ctx.headers,
      })

      expect(response.statusCode).toBe(200)
    } finally {
      process.env.NODE_ENV = original
      delete process.env.PAGAMENTO_SIMULACAO_HABILITADA
    }
  })

  it("a rota de status continua existindo em produção", async () => {
    // Só a de simulação é condicional — o polling é fluxo normal.
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = "production"

    try {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const ctx = await criarContexto()
      const { payment_id } = (await iniciarPix(app, ctx)).json()

      const response = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${payment_id}/status`,
        headers: ctx.headers,
      })

      expect(response.statusCode).toBe(200)
    } finally {
      process.env.NODE_ENV = original
    }
  })
})
