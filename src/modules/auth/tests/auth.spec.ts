import { beforeEach, describe, expect, it } from "vitest"
import { AuthService } from "../service/AuthService"
import { AuthPrismaRepository } from "../repository/AuthPrismaRepository"
import { prisma } from "@/lib/prisma"
import { EmailAlreadyInUseError } from "@/shared/errors"

describe("Auth Module - Integration Tests (DB)", () => {
  let authRepository: AuthPrismaRepository
  let sut: AuthService

  beforeEach(() => {
    authRepository = new AuthPrismaRepository(prisma)
    sut = new AuthService(authRepository)
  })

  it("Deve cadastrar um usuário com sucesso", async () => {
    const response = await sut.signUp({
      email: "usuario@email.com",
      name: "usuario",
      password: "senha123",
    })

    expect(response.message).toBe("Usuário criado com sucesso")
    expect(response.user.id).toBeDefined()
    expect(response.user.email).toBe("usuario@email.com")

    const userInDb = await prisma.user.findUnique({
      where: { email: "usuario@email.com" },
    })
    expect(userInDb).not.toBeNull()

    console.log("Usuário cadastrado com sucesso:", response.user)
  })

  it("Deve lançar erro ao tentar cadastrar usuário já existente", async () => {
    // Cadastro inicial
    await sut.signUp({
      email: "existente@email.com",
      name: "usuario",
      password: "senha123",
    })

    // Tentativa de duplicidade
    const error = await sut
      .signUp({
        email: "existente@email.com",
        password: "outrasenha",
        name: "usuario",
      })
      .catch((err) => err)

    expect(error).toBeInstanceOf(EmailAlreadyInUseError)
    expect(error.statusCode).toBe(409)
    expect(error.code).toBe("EMAIL_ALREADY_IN_USE")
    expect(error.details).toEqual({ field: "email" })

    console.log("Erro esperado ao duplicar cadastro:", error.message)
  })

  it("Deve realizar login com sucesso", async () => {
    await sut.signUp({
      email: "login@email.com",
      name: "usuario",
      password: "senha123",
    })

    const response = await sut.signIn({
      email: "login@email.com",
      password: "senha123",
    })

    expect(response.message).toBe("Login realizado com sucesso")
    expect(response.user.id).toBeDefined()

    console.log("Login realizado com sucesso:", response.user)
  })

  it("Deve lançar erro ao tentar logar com usuário inexistente", async () => {
    const error = await sut
      .signIn({
        email: "nao_existe@email.com",
        password: "senha123",
      })
      .catch((err) => err)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("Credenciais inválidas")

    console.log("Erro esperado ao logar com usuário inexistente:", error.message)
  })

  it("Deve ser possivel gerar token e redefinir senha", async () => {
    // 1. Cria usuário
    const user = await sut.signUp({
      email: "reset@email.com",
      name: "usuario",
      password: "senha123",
    })
    console.log("1. Usuário criado para o teste de reset:", user.user)

    // 2. Solicita reset
    const response = await sut.requestResetPassword("reset@email.com")
    expect(response.status).toBe(true)
    console.log("2. Solicitação de reset de senha:", response)

    // Note: O Better Auth salva o token no banco com hash por segurança.
    // Para testar o fluxo, vamos extrair o token (plain-text) que foi enviado para o email (mock do brevo).
    const sendMock = (await import("@/lib/brevo")).sendEmail as any
    const emailArgs = sendMock.mock.calls[0][0]

    // O HTML contém: "Seu token é: XYZ"
    const match = emailArgs.html.match(/Seu token é: ([a-zA-Z0-9_\-]+)/)
    const token = match[1]
    console.log("3. Token extraído do e-mail enviado:", token)

    // 3. Reseta a senha
    const resetResponse = await sut.resetPassword(token, "novaSenha123")
    expect(resetResponse.status).toBe(true)
    console.log("4. Resultado da redefinição de senha:", resetResponse)

    // 4. Valida se a senha mudou logando
    const loginResponse = await sut.signIn({
      email: "reset@email.com",
      password: "novaSenha123",
    })
    expect(loginResponse.user.id).toBeDefined()
    console.log("5. Login com a nova senha realizado com sucesso:", loginResponse.user)
  })
})
