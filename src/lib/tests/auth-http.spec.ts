import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"
import { app } from "@/app"

/**
 * O handler montado em /api/auth/* faz a ponte entre o Fastify e o better-auth.
 * Os demais testes chamam `auth.api` direto e nunca passaram por esta ponte, o
 * que deixou passar um 500 em todo login/cadastro hospedado.
 */
const origem = { origin: process.env.APP_URL ?? "http://localhost:3000" }

describe("handler HTTP do better-auth (/api/auth/*)", () => {
  it("cadastra, devolve o cookie de sessão e reconhece a sessão", async () => {
    const email = `http-${randomUUID()}@email.com`

    const cadastro = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: origem,
      payload: { email, password: "password123", name: "Pessoa HTTP" },
    })

    expect(cadastro.statusCode).toBe(200)
    expect(cadastro.json().user.email).toBe(email)

    const setCookie = cadastro.headers["set-cookie"]
    const cookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie)])
      .map((valor) => valor.split(";")[0])
      .join("; ")
    expect(cookie).toContain("session_token")

    const sessao = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { ...origem, cookie },
    })

    expect(sessao.statusCode).toBe(200)
    expect(sessao.json().user.email).toBe(email)
  })

  it("sem sessão responde 200 com corpo vazio, sem erro interno", async () => {
    const resposta = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: origem,
    })

    expect(resposta.statusCode).toBe(200)
  })

  it("login com senha errada devolve 401 do better-auth", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: origem,
      payload: { email: `nao-existe-${randomUUID()}@email.com`, password: "password123" },
    })

    expect(resposta.statusCode).toBe(401)
  })
})
