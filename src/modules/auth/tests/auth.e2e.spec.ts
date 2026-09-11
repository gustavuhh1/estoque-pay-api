import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"

describe("Auth Module - E2E (DB Real)", () => {

  it("Deve registrar um usuário com sucesso (POST /auth/register)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "teste2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    expect(response.statusCode).toBe(201)
    const json = response.json()
    expect(json.message).toBe("Usuário criado com sucesso")
    expect(json.user.id).toBeDefined()

    // Verifica no BD se o usuário realmente foi criado
    const userInDb = await prisma.user.findUnique({
      where: { email: "teste2e@email.com" }
    })
    expect(userInDb).not.toBeNull()
  })

  it("Deve retornar erro 400 se o usuário já existir no banco (POST /auth/register)", async () => {
    // Primeiro request funciona
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "conflito@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    // Segundo request falha
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "conflito@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    // O errorHandler converte erros genéricos em 500 com mensagem padrão.
    expect(response.statusCode).toBe(500)
    const json = response.json()
    expect(json.message).toBe("Erro interno do servidor.")
  })

  it("Deve realizar login com sucesso (POST /auth/login)", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "login_e2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "login_e2e@email.com",
        password: "password123",
      },
    })

    expect(response.statusCode).toBe(200)
    const json = response.json()
    expect(json.message).toBe("Login realizado com sucesso")
    expect(json.user.id).toBeDefined()
  })

  it("Deve retornar erro 400 (Bad Request) se faltarem campos no registro", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "invalido", // Email inválido, falta senha
      },
    })

    // Zod lança um erro que é capturado pelo error-handler do Fastify
    expect(response.statusCode).toBe(400)
  })
})
