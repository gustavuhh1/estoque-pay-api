import { describe, it, expect, vi, afterEach } from "vitest"
import crypto from "node:crypto"
import { AbacatePayGateway } from "../gateway/AbacatePayGateway"

const CONFIG = {
  apiKey: "chave-de-teste",
  webhookSecret: "segredo-de-teste",
  baseUrl: "https://api.abacatepay.test/v2",
}

function gateway() {
  return new AbacatePayGateway(CONFIG)
}

/** Resposta de sucesso no formato documentado do /transparents/create. */
function respostaOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      error: null,
      data: {
        id: "pix_char_abc123xyz",
        amount: 10000,
        status: "PENDING",
        devMode: false,
        brCode: "00020160014BR.GOV.BCB.PIX070503***6304ABCD",
        brCodeBase64: "data:image/png;base64,iVBORw0KG",
        platformFee: 80,
        expiresAt: "2026-09-20T19:38:28.573Z",
        ...overrides,
      },
    }),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AbacatePayGateway.criarCobrancaPix (#52 — RF03.1)", () => {
  it("monta a requisição no formato documentado do provedor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk())

    await gateway().criarCobrancaPix({
      valor: 100,
      descricao: "Venda no balcão",
      expira_em_segundos: 3600,
      venda_id: "venda-1",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!

    expect(url).toBe("https://api.abacatepay.test/v2/transparents/create")
    expect(init?.method).toBe("POST")
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer chave-de-teste"
    )

    const corpo = JSON.parse(init?.body as string)
    expect(corpo.method).toBe("PIX")
    expect(corpo.data.amount).toBe(10000) // reais -> centavos
    expect(corpo.data.expiresIn).toBe(3600)
    expect(corpo.data.metadata.vendaId).toBe("venda-1")
  })

  it("converte reais em centavos sem erro de float", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk())

    // 10.07 * 100 = 1006.9999999999999 em ponto flutuante binário. Math.trunc
    // daria 1006 e o cliente pagaria um centavo a menos.
    await gateway().criarCobrancaPix({
      valor: 10.07,
      descricao: "Fração chata",
      expira_em_segundos: 600,
      venda_id: "venda-2",
    })

    const corpo = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)
    expect(corpo.data.amount).toBe(1007)
  })

  it("traduz a resposta para o contrato interno", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk())

    const cobranca = await gateway().criarCobrancaPix({
      valor: 100,
      descricao: "Venda",
      expira_em_segundos: 3600,
      venda_id: "venda-1",
    })

    expect(cobranca.payment_id).toBe("pix_char_abc123xyz")
    expect(cobranca.qr_code).toContain("BR.GOV.BCB.PIX")
    expect(cobranca.qr_code_imagem).toContain("base64")
    // platformFee vem em centavos, como todo valor do provedor.
    expect(cobranca.taxa_plataforma).toBe(0.8)
    expect(cobranca.expira_em).toBeInstanceOf(Date)
  })

  it("só envia `customer` quando há dados de cliente", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk())

    await gateway().criarCobrancaPix({
      valor: 50,
      descricao: "Sem cliente",
      expira_em_segundos: 600,
      venda_id: "venda-3",
    })

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string).data).not.toHaveProperty(
      "customer"
    )
  })

  it("erro HTTP do provedor vira BadRequestError com o status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"error":"amount too low"}',
    } as unknown as Response)

    await expect(
      gateway().criarCobrancaPix({
        valor: 0.01,
        descricao: "Muito baixo",
        expira_em_segundos: 600,
        venda_id: "venda-4",
      })
    ).rejects.toMatchObject({ statusCode: 400, code: "GATEWAY_PAGAMENTO_ERRO" })
  })

  it("resposta 200 sem brCode é tratada como inválida", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: "pix_1" } }),
    } as unknown as Response)

    await expect(
      gateway().criarCobrancaPix({
        valor: 10,
        descricao: "Resposta torta",
        expira_em_segundos: 600,
        venda_id: "venda-5",
      })
    ).rejects.toMatchObject({ code: "GATEWAY_PAGAMENTO_RESPOSTA_INVALIDA" })
  })

  it("sem chave de API configurada, falha antes de tocar a rede", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const semChave = new AbacatePayGateway({ ...CONFIG, apiKey: "" })

    await expect(
      semChave.criarCobrancaPix({
        valor: 10,
        descricao: "x",
        expira_em_segundos: 600,
        venda_id: "venda-6",
      })
    ).rejects.toThrow(/ABACATEPAY_API_KEY/)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("AbacatePayGateway.verificarAssinaturaWebhook (#52 — RNF02)", () => {
  const corpo = JSON.stringify({ id: "log_1", event: "transparent.completed" })

  function assinar(texto: string, segredo = CONFIG.webhookSecret) {
    return crypto
      .createHmac("sha256", segredo)
      .update(Buffer.from(texto, "utf8"))
      .digest("base64")
  }

  it("aceita a assinatura correta", () => {
    const assinatura = assinar(corpo)

    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), assinatura)
    ).toBe(true)
  })

  it("recusa assinatura gerada com outro segredo", () => {
    const assinatura = assinar(corpo, "segredo-do-atacante")

    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), assinatura)
    ).toBe(false)
  })

  it("recusa quando o corpo foi adulterado depois de assinado", () => {
    const assinatura = assinar(corpo)
    const adulterado = JSON.stringify({ id: "log_1", event: "transparent.refunded" })

    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(adulterado, "utf8"), assinatura)
    ).toBe(false)
  })

  it("recusa assinatura ausente", () => {
    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), undefined)
    ).toBe(false)
  })

  it("recusa assinatura de tamanho diferente sem estourar o timingSafeEqual", () => {
    // crypto.timingSafeEqual lança se os buffers têm tamanhos distintos — a
    // comparação de length precisa vir antes, senão isso vira 500 em vez de 401.
    expect(() =>
      gateway().verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), "curta")
    ).not.toThrow()

    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), "curta")
    ).toBe(false)
  })

  it("é sensível a bytes: mesmo JSON reserializado não valida", () => {
    // É por isso que a rota guarda o corpo CRU em vez de re-stringificar o
    // request.body — a mudança de espaçamento já quebra o HMAC.
    const assinatura = assinar(corpo)
    const reserializado = JSON.stringify(JSON.parse(corpo), null, 2)

    expect(
      gateway().verificarAssinaturaWebhook(Buffer.from(reserializado, "utf8"), assinatura)
    ).toBe(false)
  })

  it("sem segredo configurado, falha alto em vez de aceitar qualquer coisa", () => {
    const semSegredo = new AbacatePayGateway({ ...CONFIG, webhookSecret: "" })

    expect(() =>
      semSegredo.verificarAssinaturaWebhook(Buffer.from(corpo, "utf8"), assinar(corpo))
    ).toThrow(/ABACATEPAY_WEBHOOK_SECRET/)
  })
})
