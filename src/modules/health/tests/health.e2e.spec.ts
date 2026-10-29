import { describe, it, expect, vi, afterEach } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"

describe("GET /health — E2E (Etapa 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("200 { status: ok } com o banco respondendo", async () => {
    const response = await app.inject({ method: "GET", url: "/health" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "ok" })
  })

  it("é público: não exige sessão nem header de loja", async () => {
    const response = await app.inject({ method: "GET", url: "/health" })

    expect(response.statusCode).not.toBe(401)
    expect(response.statusCode).not.toBe(400)
  })

  it("503 { status: error } quando o banco não responde", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"))

    const response = await app.inject({ method: "GET", url: "/health" })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: "error" })
  })

  it("o 503 não vaza host, usuário nem mensagem do erro do banco", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error("connect ECONNREFUSED user:segredo@10.0.0.5:5432")
    )

    const response = await app.inject({ method: "GET", url: "/health" })

    expect(response.body).not.toMatch(/segredo|10\.0\.0\.5|ECONNREFUSED/)
  })

  it("aparece no Swagger", async () => {
    const response = await app.inject({ method: "GET", url: "/apidocs/json" })

    expect(response.statusCode).toBe(200)
    expect(Object.keys(response.json().paths)).toContain("/health/")
  })
})
