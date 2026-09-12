import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"

const CNPJ_MASCARADO = "11.222.333/0001-81"
const CNPJ_NORMALIZADO = "11222333000181"

describe("Estabelecimento Module - E2E (DB Real)", () => {
  it("Deve criar o estabelecimento e vincular o criador como OWNER (POST /estabelecimento)", async () => {
    const { user, cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: {
        nome: "Mercearia do Zé",
        cnpj: CNPJ_MASCARADO,
        ie: "123456789",
        emite_nfce: true,
      },
    })

    expect(response.statusCode).toBe(201)
    const json = response.json()
    expect(json.message).toBe("Estabelecimento criado com sucesso")
    expect(json.estabelecimento.id).toBeDefined()
    // A máscara entrou, mas o que persiste (e volta) são só os dígitos.
    expect(json.estabelecimento.cnpj).toBe(CNPJ_NORMALIZADO)
    expect(json.membro.role).toBe("OWNER")
    expect(json.membro.userId).toBe(user.id)

    const membroNoBanco = await prisma.membroEstabelecimento.findUnique({
      where: {
        userId_estabelecimentoId: {
          userId: user.id,
          estabelecimentoId: json.estabelecimento.id,
        },
      },
    })
    expect(membroNoBanco?.role).toBe("OWNER")
  })

  it("Não deve expor dados sensíveis do certificado na resposta", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: { nome: "Loja Segura", cnpj: CNPJ_NORMALIZADO },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().estabelecimento).not.toHaveProperty(
      "certificado_a1_senha"
    )
    expect(response.json().estabelecimento).not.toHaveProperty("certificado_a1")
  })

  it("Deve retornar 400 se o CNPJ não for informado", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: { nome: "Loja Sem CNPJ" },
    })

    expect(response.statusCode).toBe(400)
    const json = response.json()
    expect(json.code).toBe("VALIDATION_ERROR")
    expect(
      json.details.issues.map((issue: { field: string }) => issue.field)
    ).toContain("cnpj")
  })

  it("Deve retornar 400 se o nome não for informado", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: { cnpj: CNPJ_NORMALIZADO },
    })

    expect(response.statusCode).toBe(400)
    const json = response.json()
    expect(json.code).toBe("VALIDATION_ERROR")
    expect(
      json.details.issues.map((issue: { field: string }) => issue.field)
    ).toContain("nome")
  })

  it("Deve retornar 400 para CNPJ com dígito verificador inválido", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: { nome: "Loja CNPJ Falso", cnpj: "11111111111111" },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe("VALIDATION_ERROR")
  })

  it("Deve retornar 401 quando não há sessão", async () => {
    // Body válido de propósito: o preHandler roda depois da validação, então
    // um body inválido mascararia o 401 com um 400.
    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      payload: { nome: "Loja Anônima", cnpj: CNPJ_NORMALIZADO },
    })

    expect(response.statusCode).toBe(401)
    const json = response.json()
    expect(json.code).toBe("UNAUTHORIZED")
    expect(json.requestId).toBeDefined()
  })

  it("Deve retornar 401 quando o cookie de sessão é inválido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie: "better-auth.session_token=token_invalido" },
      payload: { nome: "Loja Falsa", cnpj: CNPJ_NORMALIZADO },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe("UNAUTHORIZED")
  })

  it("Deve retornar 409 se o CNPJ já existir na plataforma", async () => {
    const primeiro = await createAuthenticatedUser()

    await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie: primeiro.cookie },
      payload: { nome: "Primeira Loja", cnpj: CNPJ_NORMALIZADO },
    })

    // Outro usuário tentando registrar o mesmo CNPJ.
    const segundo = await createAuthenticatedUser()

    const response = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie: segundo.cookie },
      payload: { nome: "Segunda Loja", cnpj: CNPJ_MASCARADO },
    })

    expect(response.statusCode).toBe(409)
    const json = response.json()
    expect(json.code).toBe("CNPJ_ALREADY_IN_USE")
    expect(json.details.field).toBe("cnpj")
    expect(json.requestId).toBeDefined()
  })

  it("Deve retornar 409 (e nunca 500) em criações simultâneas do mesmo CNPJ", async () => {
    const { cookie } = await createAuthenticatedUser()
    const payload = { nome: "Loja Corrida", cnpj: CNPJ_NORMALIZADO }

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/estabelecimento",
        headers: { cookie },
        payload,
      }),
      app.inject({
        method: "POST",
        url: "/estabelecimento",
        headers: { cookie },
        payload,
      }),
    ])

    const statusCodes = responses.map((response) => response.statusCode).sort()
    expect(statusCodes).toEqual([201, 409])
    expect(
      responses.find((response) => response.statusCode === 409)?.json().code
    ).toBe("CNPJ_ALREADY_IN_USE")
  })
})
