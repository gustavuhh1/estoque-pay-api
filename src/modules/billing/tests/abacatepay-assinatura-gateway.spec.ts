import { describe, it, expect, vi } from "vitest"
import {
  AbacatePayAssinaturaGateway,
  lerExternalId,
  montarExternalId,
} from "../gateway/AbacatePayAssinaturaGateway"

/**
 * O adaptador é testado com um cliente do SDK simulado: aqui se prova O QUE ele
 * manda para a AbacatePay (produto com trial e ciclo, checkout só no cartão,
 * externalId da loja) e como lê as respostas. Não toca a rede.
 */
const ok = <T>(data: T) => ({ data, error: null, success: true as const })
const falha = (error: string) => ({ data: null, error, success: false as const })

function clienteSimulado() {
  return {
    products: {
      get: vi.fn().mockResolvedValue(falha("not found")),
      create: vi.fn().mockResolvedValue(ok({ id: "prod_mensal" })),
    },
    customers: { create: vi.fn().mockResolvedValue(ok({ id: "cust_1" })) },
    subscriptions: {
      create: vi.fn().mockResolvedValue(
        ok({ id: "bill_1", url: "https://app.abacatepay.com/pay/bill_1" })
      ),
      get: vi.fn(),
      cancel: vi.fn().mockResolvedValue(ok({ id: "subs_1", status: "CANCELLED" })),
      checkouts: { get: vi.fn() },
    },
  }
}

function gatewayCom(client: ReturnType<typeof clienteSimulado>) {
  return new AbacatePayAssinaturaGateway({ client: client as never })
}

const PARAMS = {
  estabelecimento_id: "loja-1",
  tipo_plano: "MENSAL" as const,
  cliente: { email: "dono@email.com", nome: "Mercearia do Zé", documento: "11222333000181" },
  url_retorno: "http://localhost:3000/ajustes",
  url_conclusao: "http://localhost:3000/ajustes?assinatura=concluida",
}

describe("AbacatePayAssinaturaGateway.criarCheckoutAssinatura (#65 — D2)", () => {
  it("cria o produto do plano com ciclo e 7 dias de trial (o trial vem do produto)", async () => {
    const client = clienteSimulado()

    await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    expect(client.products.create).toHaveBeenCalledWith({
      externalId: "estoquepay-premium-mensal",
      name: "EstoquePay Premium (mensal)",
      price: 3000,
      currency: "BRL",
      cycle: "MONTHLY",
      trialDays: 7,
    })
  })

  it("plano anual: R$ 299,90 em centavos e ciclo ANNUALLY", async () => {
    const client = clienteSimulado()
    client.products.create.mockResolvedValue(ok({ id: "prod_anual" }))

    await gatewayCom(client).criarCheckoutAssinatura({ ...PARAMS, tipo_plano: "ANUAL" })

    expect(client.products.create).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "estoquepay-premium-anual",
        price: 29990,
        cycle: "ANNUALLY",
        trialDays: 7,
      })
    )
  })

  it("checkout SÓ NO CARTÃO, com um item, o cliente e a loja no externalId", async () => {
    const client = clienteSimulado()

    const resultado = await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    expect(client.subscriptions.create).toHaveBeenCalledTimes(1)
    const corpo = client.subscriptions.create.mock.calls[0]?.[0]
    expect(corpo).toMatchObject({
      items: [{ id: "prod_mensal", quantity: 1 }],
      methods: ["CARD"],
      customerId: "cust_1",
      returnUrl: PARAMS.url_retorno,
      completionUrl: PARAMS.url_conclusao,
    })
    // Pix nunca aparece (D2).
    expect(JSON.stringify(corpo)).not.toContain("PIX")
    expect(corpo.externalId).toMatch(/^loja-1:MENSAL:\d+$/)
    expect(resultado).toEqual({
      checkout_id: "bill_1",
      url: "https://app.abacatepay.com/pay/bill_1",
      customer_id: "cust_1",
    })
  })

  it("cadastra o cliente com e-mail, nome e CNPJ (taxId)", async () => {
    const client = clienteSimulado()

    await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    expect(client.customers.create).toHaveBeenCalledWith({
      email: "dono@email.com",
      name: "Mercearia do Zé",
      taxId: "11222333000181",
    })
  })

  it("nenhum dado de cartão trafega por aqui (RNF02)", async () => {
    const client = clienteSimulado()

    await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    const tudo = JSON.stringify([
      client.products.create.mock.calls,
      client.customers.create.mock.calls,
      client.subscriptions.create.mock.calls,
    ])
    expect(tudo).not.toMatch(/card(Token|Number)|cvv|ctok_/i)
  })

  it("reaproveita o produto existente (busca por externalId) e não recria", async () => {
    const client = clienteSimulado()
    client.products.get.mockResolvedValue(ok({ id: "prod_existente" }))

    await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    expect(client.products.create).not.toHaveBeenCalled()
    expect(client.subscriptions.create.mock.calls[0]?.[0].items[0].id).toBe("prod_existente")
  })

  it("guarda o produto em cache: a 2ª contratação não consulta o produto de novo", async () => {
    const client = clienteSimulado()
    const gateway = gatewayCom(client)

    await gateway.criarCheckoutAssinatura(PARAMS)
    await gateway.criarCheckoutAssinatura(PARAMS)

    expect(client.products.get).toHaveBeenCalledTimes(1)
    expect(client.products.create).toHaveBeenCalledTimes(1)
  })

  it("se outro processo criou o produto na mesma hora, relê em vez de falhar", async () => {
    const client = clienteSimulado()
    client.products.get
      .mockResolvedValueOnce(falha("not found"))
      .mockResolvedValueOnce(ok({ id: "prod_do_outro" }))
    client.products.create.mockResolvedValue(falha("externalId duplicado"))

    await gatewayCom(client).criarCheckoutAssinatura(PARAMS)

    expect(client.subscriptions.create.mock.calls[0]?.[0].items[0].id).toBe("prod_do_outro")
  })

  it("recusa do provedor vira 400 GATEWAY_ASSINATURA_ERRO, em cada etapa", async () => {
    const semProduto = clienteSimulado()
    semProduto.products.create.mockResolvedValue(falha("price inválido"))
    semProduto.products.get.mockResolvedValue(falha("not found"))
    await expect(gatewayCom(semProduto).criarCheckoutAssinatura(PARAMS)).rejects.toMatchObject({
      statusCode: 400,
      code: "GATEWAY_ASSINATURA_ERRO",
    })

    const semCliente = clienteSimulado()
    semCliente.customers.create.mockResolvedValue(falha("email inválido"))
    await expect(gatewayCom(semCliente).criarCheckoutAssinatura(PARAMS)).rejects.toMatchObject({
      code: "GATEWAY_ASSINATURA_ERRO",
    })

    const semCheckout = clienteSimulado()
    semCheckout.subscriptions.create.mockResolvedValue(falha("produto sem ciclo"))
    await expect(gatewayCom(semCheckout).criarCheckoutAssinatura(PARAMS)).rejects.toMatchObject({
      code: "GATEWAY_ASSINATURA_ERRO",
      details: { resposta: "produto sem ciclo" },
    })
  })

  it("sem ABACATEPAY_API_KEY, falha alto em vez de seguir", async () => {
    const semChave = new AbacatePayAssinaturaGateway({ apiKey: "" })

    await expect(semChave.criarCheckoutAssinatura(PARAMS)).rejects.toThrow(/ABACATEPAY_API_KEY/)
  })
})

describe("AbacatePayAssinaturaGateway.consultarAssinatura (#67)", () => {
  const assinatura = {
    id: "subs_1",
    checkoutId: "bill_1",
    customerId: "cust_1",
    status: "ACTIVE",
    trialEndsAt: "2026-11-08T12:00:00.000Z",
  }

  it("por subs_: lê a assinatura e acha a loja no externalId do checkout de origem", async () => {
    const client = clienteSimulado()
    client.subscriptions.get.mockResolvedValue(ok(assinatura))
    client.subscriptions.checkouts.get.mockResolvedValue(
      ok({ externalId: "loja-1:ANUAL:1730000000000" })
    )

    const resultado = await gatewayCom(client).consultarAssinatura("subs_1")

    expect(client.subscriptions.get).toHaveBeenCalledWith({ id: "subs_1" })
    expect(client.subscriptions.checkouts.get).toHaveBeenCalledWith("bill_1")
    expect(resultado).toEqual({
      subscription_id: "subs_1",
      customer_id: "cust_1",
      status: "ACTIVE",
      trial_expira_em: new Date("2026-11-08T12:00:00.000Z"),
      estabelecimento_id: "loja-1",
      tipo_plano: "ANUAL",
    })
  })

  it("por bill_: lê o checkout e busca a assinatura pelo externalId", async () => {
    const client = clienteSimulado()
    client.subscriptions.checkouts.get.mockResolvedValue(
      ok({ externalId: "loja-1:MENSAL:1730000000000" })
    )
    client.subscriptions.get.mockResolvedValue(ok(assinatura))

    const resultado = await gatewayCom(client).consultarAssinatura("bill_1")

    expect(client.subscriptions.get).toHaveBeenCalledWith({
      externalId: "loja-1:MENSAL:1730000000000",
    })
    expect(resultado?.estabelecimento_id).toBe("loja-1")
  })

  it("sem trial, trial_expira_em é null", async () => {
    const client = clienteSimulado()
    client.subscriptions.get.mockResolvedValue(ok({ ...assinatura, trialEndsAt: null }))
    client.subscriptions.checkouts.get.mockResolvedValue(ok({ externalId: "loja-1:MENSAL:1" }))

    const resultado = await gatewayCom(client).consultarAssinatura("subs_1")

    expect(resultado?.trial_expira_em).toBeNull()
  })

  it("assinatura que o provedor não conhece devolve null", async () => {
    const client = clienteSimulado()
    client.subscriptions.get.mockResolvedValue(falha("not found"))

    expect(await gatewayCom(client).consultarAssinatura("subs_x")).toBeNull()
  })

  it("checkout que o provedor não conhece devolve null", async () => {
    const client = clienteSimulado()
    client.subscriptions.checkouts.get.mockResolvedValue(falha("not found"))

    expect(await gatewayCom(client).consultarAssinatura("bill_x")).toBeNull()
  })

  it("assinatura sem checkout de origem vem sem loja (não é nossa)", async () => {
    const client = clienteSimulado()
    client.subscriptions.get.mockResolvedValue(ok({ ...assinatura, checkoutId: null }))

    const resultado = await gatewayCom(client).consultarAssinatura("subs_1")

    expect(resultado?.estabelecimento_id).toBeNull()
  })

  it("externalId que não é nosso não aponta para loja nenhuma", async () => {
    const client = clienteSimulado()
    client.subscriptions.get.mockResolvedValue(ok(assinatura))
    client.subscriptions.checkouts.get.mockResolvedValue(ok({ externalId: null }))

    const resultado = await gatewayCom(client).consultarAssinatura("subs_1")

    expect(resultado?.estabelecimento_id).toBeNull()
  })
})

describe("AbacatePayAssinaturaGateway.cancelarAssinatura (#66)", () => {
  it("cancela pelo id da assinatura", async () => {
    const client = clienteSimulado()

    await gatewayCom(client).cancelarAssinatura("subs_1")

    expect(client.subscriptions.cancel).toHaveBeenCalledWith("subs_1")
  })

  it("recusa do provedor vira 400", async () => {
    const client = clienteSimulado()
    client.subscriptions.cancel.mockResolvedValue(falha("já cancelada"))

    await expect(gatewayCom(client).cancelarAssinatura("subs_1")).rejects.toMatchObject({
      code: "GATEWAY_ASSINATURA_ERRO",
    })
  })
})

describe("externalId do checkout", () => {
  it("leva a loja e o plano e permite recuperá-los", () => {
    const externalId = montarExternalId("loja-9", "ANUAL")

    expect(lerExternalId(externalId)).toEqual({ estabelecimento_id: "loja-9", tipo_plano: "ANUAL" })
  })

  it("a cada checkout é um valor novo, para refazer um checkout abandonado", async () => {
    const a = montarExternalId("loja-9", "MENSAL")
    await new Promise((resolve) => setTimeout(resolve, 3))
    const b = montarExternalId("loja-9", "MENSAL")

    expect(a).not.toBe(b)
  })

  it("valor vazio ou ausente não aponta para loja", () => {
    expect(lerExternalId(null)).toBeNull()
    expect(lerExternalId("")).toBeNull()
  })

  it("plano desconhecido vira null, mas a loja continua identificada", () => {
    expect(lerExternalId("loja-1:TRIMESTRAL:1")).toEqual({
      estabelecimento_id: "loja-1",
      tipo_plano: null,
    })
  })
})
