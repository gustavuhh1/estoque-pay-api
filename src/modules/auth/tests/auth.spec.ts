import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthService } from "../service/AuthService"
import { InMemoryAuthRepository } from "../repository/InMemoryAuthRepository"
import { auth } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: vi.fn(),
      signInEmail: vi.fn(),
    },
  },
}))

describe("Auth Module - Unit Tests (DDD)", () => {
  let authRepository: InMemoryAuthRepository
  let sut: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    authRepository = new InMemoryAuthRepository()

    // Injeção de dependências limpa (usando mock do better-auth global)
    sut = new AuthService(authRepository)
  })

  it("Deve cadastrar um usuário com sucesso", async () => {
    ;(auth.api.signUpEmail as any).mockResolvedValue({
      user: { id: "123", email: "usuario@email.com" },
    })

    const response = await sut.signUp({
      email: "usuario@email.com",
      name: "usuario",
      password: "senha123",
    })

    expect(auth.api.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: "usuario@email.com",
          password: "senha123",
          name: "usuario",
          image: undefined,
        }),
      }),
    )
    expect(response.message).toBe("Usuário criado com sucesso")
    expect(response.user.id).toBeDefined()
  })

  it("Deve realizar login com sucesso", async () => {
    authRepository.users.push({
      id: "123",
      email: "usuario@email.com",
      emailVerified: false,
      name: "usuario",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
    ;(auth.api.signInEmail as any).mockResolvedValue({
      user: { id: "123", email: "usuario@email.com" },
    })
    const response = await sut.signIn({
      email: "usuario@email.com",
      password: "senha123",
    })

    expect(auth.api.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: "usuario@email.com",
          password: "senha123",
        }),
      }),
    )
    expect(response.message).toBe("Login realizado com sucesso")
    expect(response.user.id).toBe("123")
  })

  it("Deve lançar erro ao tentar cadastrar usuário já existente", async () => {
    authRepository.users.push({
      id: "123",
      email: "usuario@email.com",
      emailVerified: false,
      name: "usuario",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)

    await expect(
      sut.signUp({
        email: "usuario@email.com",
        password: "outrasenha",
        name: "usuario",
      }),
    ).rejects.toThrow("Usuário já cadastrado")

    expect(auth.api.signUpEmail).not.toHaveBeenCalled()
  })

  it("Deve lançar erro ao tentar logar com usuário inexistente", async () => {
    await expect(
      sut.signIn({
        email: "nao_existe@email.com",
        password: "senha123",
      }),
    ).rejects.toThrow("Credenciais inválidas")

    expect(auth.api.signInEmail).not.toHaveBeenCalled()
  })
})
