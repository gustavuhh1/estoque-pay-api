import { describe, it, expect } from "vitest"
import fastify from "fastify"
import cors from "@fastify/cors"
import { opcoesDeCors, origensConfiaveis } from "../origens"

const env = (valores: Record<string, string>) => valores as unknown as NodeJS.ProcessEnv

describe("origensConfiaveis (Etapa 5)", () => {
  it("junta TRUSTED_ORIGINS e APP_URL", () => {
    const origens = origensConfiaveis(
      env({ TRUSTED_ORIGINS: "https://a.exemplo.com, https://b.exemplo.com", APP_URL: "https://app.exemplo.com" })
    )

    expect(origens).toEqual(["https://a.exemplo.com", "https://b.exemplo.com", "https://app.exemplo.com"])
  })

  it("reduz à origem: tira caminho e barra final, como o navegador manda o Origin", () => {
    expect(
      origensConfiaveis(env({ APP_URL: "https://app.exemplo.com/ajustes/" }))
    ).toEqual(["https://app.exemplo.com"])
  })

  it("não repete a mesma origem", () => {
    expect(
      origensConfiaveis(env({ TRUSTED_ORIGINS: "https://app.exemplo.com", APP_URL: "https://app.exemplo.com/" }))
    ).toEqual(["https://app.exemplo.com"])
  })

  it("ignora vazio e valor que não é URL", () => {
    expect(
      origensConfiaveis(env({ TRUSTED_ORIGINS: " , localhost:3000, nao-e-url ,https://ok.com" }))
    ).toEqual(["https://ok.com"])
  })

  it("sem nada configurado, devolve lista vazia", () => {
    expect(origensConfiaveis(env({}))).toEqual([])
  })

  it("preserva a porta", () => {
    expect(origensConfiaveis(env({ APP_URL: "http://localhost:5173" }))).toEqual([
      "http://localhost:5173",
    ])
  })
})

describe("opcoesDeCors (Etapa 5)", () => {
  it("fora de produção fica aberto, para o front de desenvolvimento em qualquer porta", () => {
    expect(opcoesDeCors(env({ NODE_ENV: "development", APP_URL: "https://app.exemplo.com" }))).toEqual({
      origin: true,
    })
    expect(opcoesDeCors(env({ NODE_ENV: "test" }))).toEqual({ origin: true })
  })

  it("em produção restringe às origens confiáveis e liga credentials (cookie de sessão)", () => {
    expect(
      opcoesDeCors(env({ NODE_ENV: "production", APP_URL: "https://app.exemplo.com" }))
    ).toEqual({ origin: ["https://app.exemplo.com"], credentials: true })
  })

  it("produção SEM origem configurada recusa tudo em vez de abrir", () => {
    const opcoes = opcoesDeCors(env({ NODE_ENV: "production" }))

    expect(opcoes.origin).toEqual([])
    expect(opcoes.origin).not.toBe(true)
  })
})

describe("CORS em produção — preflight real", () => {
  async function montar() {
    const app = fastify()
    await app.register(
      cors,
      opcoesDeCors(env({ NODE_ENV: "production", APP_URL: "https://app.exemplo.com" }))
    )
    app.get("/ping", async () => ({ ok: true }))
    await app.ready()
    return app
  }

  const preflight = (app: Awaited<ReturnType<typeof montar>>, origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-estabelecimento-id",
      },
    })

  it("origem permitida: devolve a origem e Allow-Credentials", async () => {
    const app = await montar()

    const resposta = await preflight(app, "https://app.exemplo.com")

    expect(resposta.headers["access-control-allow-origin"]).toBe("https://app.exemplo.com")
    expect(resposta.headers["access-control-allow-credentials"]).toBe("true")
    // O header de loja do multi-tenant precisa passar no preflight.
    expect(String(resposta.headers["access-control-allow-headers"]).toLowerCase()).toContain(
      "x-estabelecimento-id"
    )
  })

  it("origem desconhecida: NÃO recebe Allow-Origin", async () => {
    const app = await montar()

    const resposta = await preflight(app, "https://site-do-atacante.com")

    expect(resposta.headers["access-control-allow-origin"]).toBeUndefined()
  })

  it("nunca reflete a origem do atacante nem usa curinga com credentials", async () => {
    const app = await montar()

    const resposta = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "https://site-do-atacante.com" },
    })

    expect(resposta.headers["access-control-allow-origin"]).not.toBe("https://site-do-atacante.com")
    expect(resposta.headers["access-control-allow-origin"]).not.toBe("*")
  })
})
