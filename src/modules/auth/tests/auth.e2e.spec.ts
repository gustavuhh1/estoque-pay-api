import { describe, it, expect, vi, beforeEach } from "vitest"
import { app } from "@/app"

// Mock do prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

// Mock do better-auth
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: vi.fn(),
      signInEmail: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

describe("Auth Module - E2E (Mocked DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Deve registrar um usuário com sucesso (POST /auth/register)", async () => {
    // Arrange
    // O mock garante que não há usuário cadastrado
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    
    // Mock do Better Auth
    ;(auth.api.signUpEmail as any).mockResolvedValue({
      user: { id: "e2e-123", email: "teste2e@email.com" },
    })

    // Act
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "teste2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    // Assert
    expect(response.statusCode).toBe(201)
    const json = response.json()
    expect(json.message).toBe("Usuário criado com sucesso")
    expect(json.user.id).toBe("e2e-123")
  })

  it("Deve realizar login com sucesso (POST /auth/login)", async () => {
    // Arrange
    // O mock garante que o usuário existe no DB local
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "e2e-123",
      email: "teste2e@email.com",
    })
    
    // Mock do Better Auth logando com sucesso
    ;(auth.api.signInEmail as any).mockResolvedValue({
      user: { id: "e2e-123", email: "teste2e@email.com" },
    })

    // Act
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "teste2e@email.com",
        password: "password123",
      },
    })

    // Assert
    expect(response.statusCode).toBe(200)
    const json = response.json()
    expect(json.message).toBe("Login realizado com sucesso")
    expect(json.user.id).toBe("e2e-123")
  })

  it("Deve retornar erro 400 (Bad Request) se faltarem campos no registro", async () => {
    // Act
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "invalido", // Email inválido, falta senha
      },
    })

    // Assert
    // Zod lança um erro que é capturado pelo error-handler do Fastify
    expect(response.statusCode).toBe(400)
    
    // Garantir que não chamou o DB
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("Deve retornar erro 400 se o usuário já existir no banco (POST /auth/register)", async () => {
    // Arrange: Simula usuário já existente
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "e2e-123",
      email: "teste2e@email.com",
    })

    // Act
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "teste2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    })

    // Assert
    // O errorHandler converte erros genéricos em 500 com mensagem padrão.
    expect(response.statusCode).toBe(500)
    const json = response.json()
    expect(json.message).toBe("Erro interno do servidor.")
    expect(auth.api.signUpEmail).not.toHaveBeenCalled()
  })
})
