import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { app } from "@/app"

/**
 * E2E da rota pública de webhook (issue #52, RNF02).
 *
 * Usa o gateway REAL (não o dublê): a validação de assinatura é crypto puro,
 * sem rede, então o caminho exercitado aqui é exatamente o de produção —
 * inclusive o parser de corpo cru e o hook de preValidation registrados no
 * escopo da rota.
 *
 * O segredo é fixado pelo `vitest.setup.ts` (não pelo `.env.test`, que está no
 * .gitignore e não chegaria em quem clona o repo).
 */
const SEGREDO = "segredo-de-webhook-de-teste"

function assinar(corpo: string, segredo = SEGREDO) {
  return crypto.createHmac("sha256", segredo).update(Buffer.from(corpo, "utf8")).digest("base64")
}

function corpoDe(event: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "log_abc123xyz",
    event,
    apiVersion: 2,
    devMode: true,
    data,
  })
}

async function enviar(corpo: string, assinatura?: string) {
  return app.inject({
    method: "POST",
    url: "/pagamento/webhook/abacatepay",
    headers: {
      "content-type": "application/json",
      ...(assinatura !== undefined && { "x-webhook-signature": assinatura }),
    },
    payload: corpo,
  })
}

describe("POST /pagamento/webhook/abacatepay - E2E (#52)", () => {
  it("200 — assinatura válida, evento de Pix pago é aceito", async () => {
    const corpo = corpoDe("transparent.completed", { id: "pix_char_abc" })

    const response = await enviar(corpo, assinar(corpo))

    expect(response.statusCode).toBe(200)
    expect(response.json().recebido).toBe(true)
  })

  it("401 — assinatura inválida (critério de aceite da RNF02)", async () => {
    const corpo = corpoDe("transparent.completed")

    const response = await enviar(corpo, assinar(corpo, "segredo-do-atacante"))

    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe("WEBHOOK_ASSINATURA_INVALIDA")
  })

  it("401 — sem o header de assinatura", async () => {
    const corpo = corpoDe("transparent.completed")

    const response = await enviar(corpo)

    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe("WEBHOOK_ASSINATURA_INVALIDA")
  })

  it("401 — corpo adulterado depois de assinado", async () => {
    const original = corpoDe("transparent.completed", { id: "pix_char_abc" })
    const assinatura = assinar(original)
    const adulterado = corpoDe("transparent.completed", { id: "pix_char_DO_ATACANTE" })

    const response = await enviar(adulterado, assinatura)

    expect(response.statusCode).toBe(401)
  })

  it("401 — assinatura de tamanho diferente não derruba a rota com 500", async () => {
    const corpo = corpoDe("transparent.completed")

    const response = await enviar(corpo, "curta")

    expect(response.statusCode).toBe(401)
  })

  it("401 — corpo ilegível responde assinatura inválida, não erro de parse", async () => {
    // Lixo vindo de fora: a resposta certa é 401 (origem não comprovada), não
    // 400 — um 400 confirmaria ao atacante que ele passou pela autenticação.
    const response = await enviar("isto não é json", "qualquer-coisa")

    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe("WEBHOOK_ASSINATURA_INVALIDA")
  })

  it("200 processado:false — evento que não consolida venda", async () => {
    // Responder erro aqui faria o provedor reenviar para sempre um evento que
    // nunca vamos tratar.
    const corpo = corpoDe("subscription.renewed")

    const response = await enviar(corpo, assinar(corpo))

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recebido: true, processado: false })
  })

  it("a rota é pública: funciona sem cookie de sessão e sem header de loja", async () => {
    const corpo = corpoDe("transparent.completed")

    const response = await enviar(corpo, assinar(corpo))

    // Nem 401 de sessão, nem 400 de TENANT_HEADER_REQUIRED.
    expect(response.statusCode).toBe(200)
  })

  it("o parser de corpo cru não vaza para as outras rotas da API", async () => {
    // O addContentTypeParser é encapsulado no escopo do webhook. Se vazasse, as
    // rotas normais receberiam Buffer no lugar do objeto e quebrariam.
    // Body VÁLIDO de propósito: o schema é validado antes do preHandler, então
    // um body inválido sairia como 400 e não provaria nada sobre o parse.
    const response = await app.inject({
      method: "POST",
      url: "/estoque/movimentacao",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        produto_id: "00000000-0000-0000-0000-000000000000",
        tipo: "ENTRADA",
        quantidade: 1,
        motivo: "REABASTECIMENTO",
      }),
    })

    // 401 de sessão ausente: o corpo passou pelo parser JSON normal e pelo
    // schema, e a rota só parou no requireAuth.
    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe("UNAUTHORIZED")
  })
})
