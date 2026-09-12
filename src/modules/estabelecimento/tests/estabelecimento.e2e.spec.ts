import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_MASCARADO = "11.222.333/0001-81"
const CNPJ_NORMALIZADO = "11222333000181"
const OUTRO_CNPJ_NORMALIZADO = "11444777000161"

async function criarEstabelecimento(cnpj: string) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj },
  })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({
    data: { userId, estabelecimentoId, role },
  })
}

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
    // emite_nfce não é parâmetro de criação: nasce sempre false (RN01/RN01.1,
    // issue #59 — ligar o switch depende de um pre-check que não existe aqui).
    expect(json.estabelecimento.emite_nfce).toBe(false)

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

describe("Estabelecimento Module - Loja Ativa E2E (RF03.1 / RF03.2 / RF04.1 / RF04.2)", () => {
  describe("GET /estabelecimento", () => {
    it("Deve listar só as lojas do usuário autenticado, cada uma com o cargo dele", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const outroUsuario = await createAuthenticatedUser()

      const lojaA = await criarEstabelecimento(CNPJ_NORMALIZADO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_NORMALIZADO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      await criarMembro(user.id, lojaB.id, "CASHIER")
      await criarMembro(outroUsuario.user.id, lojaA.id, "MANAGER") // não deve vazar pra este teste

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento",
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json).toHaveLength(2)
      expect(json.map((item: { id: string }) => item.id).sort()).toEqual(
        [lojaA.id, lojaB.id].sort()
      )
      expect(json.find((item: { id: string }) => item.id === lojaA.id).role).toBe(
        "OWNER"
      )
      expect(json.find((item: { id: string }) => item.id === lojaB.id).role).toBe(
        "CASHIER"
      )
    })

    it("Deve retornar 401 sem sessão", async () => {
      const response = await app.inject({ method: "GET", url: "/estabelecimento" })

      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe("UNAUTHORIZED")
    })
  })

  describe("GET /estabelecimento/ativo", () => {
    it("Deve retornar os dados completos da loja quando há vínculo (inclusive para CASHIER)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json.id).toBe(loja.id)
      expect(json.role).toBe("CASHIER")
      expect(json).not.toHaveProperty("certificado_a1_senha")
    })

    it("Deve retornar 403 (TENANT_ACCESS_DENIED) quando o usuário não tem vínculo com a loja do header", async () => {
      const { cookie } = await createAuthenticatedUser()
      const lojaDeOutrem = await criarEstabelecimento(CNPJ_NORMALIZADO)

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": lojaDeOutrem.id },
      })

      expect(response.statusCode).toBe(403)
      const json = response.json()
      expect(json.code).toBe("TENANT_ACCESS_DENIED")
      expect(json.requestId).toBeDefined()
    })

    it("Deve retornar 400 (TENANT_HEADER_REQUIRED) quando o header não é enviado", async () => {
      const { cookie } = await createAuthenticatedUser()

      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo",
        headers: { cookie },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
    })

    it("Deve retornar 401 sem sessão (antes mesmo de checar o header)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/estabelecimento/ativo",
      })

      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe("UNAUTHORIZED")
    })
  })

  describe("PATCH /estabelecimento/ativo", () => {
    it("Deve permitir que o OWNER atualize todos os dados cadastrais", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Novo Nome", cnpj: OUTRO_CNPJ_NORMALIZADO },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().nome).toBe("Novo Nome")
      expect(response.json().cnpj).toBe(OUTRO_CNPJ_NORMALIZADO)

      const noBanco = await prisma.estabelecimento.findUnique({
        where: { id: loja.id },
      })
      expect(noBanco?.nome).toBe("Novo Nome")
    })

    it("Deve retornar 403 quando o MANAGER tenta alterar o CNPJ (dado crítico)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "MANAGER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { cnpj: OUTRO_CNPJ_NORMALIZADO },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("CRITICAL_FIELD_FORBIDDEN")
    })

    it("Deve permitir que o MANAGER atualize só o nome (campo não-crítico)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "MANAGER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Ajustado Pelo Gestor" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().nome).toBe("Ajustado Pelo Gestor")
    })

    it("Deve retornar 403 quando o CASHIER tenta editar qualquer campo", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Tentativa do Caixa" },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_EDIT_STORE")
    })

    it("Deve retornar 403 (TENANT_ACCESS_DENIED) quando o usuário não tem vínculo com a loja do header", async () => {
      const { cookie } = await createAuthenticatedUser()
      const lojaDeOutrem = await criarEstabelecimento(CNPJ_NORMALIZADO)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": lojaDeOutrem.id },
        payload: { nome: "Invasão" },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("TENANT_ACCESS_DENIED")
    })

    it("Deve retornar 400 quando o body está vazio", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("Deve retornar 400 para CNPJ com dígito verificador inválido", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { cnpj: "11111111111111" },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("Deve retornar 409 quando o CNPJ já pertence a outra loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarEstabelecimento(OUTRO_CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { cnpj: OUTRO_CNPJ_NORMALIZADO },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("CNPJ_ALREADY_IN_USE")
    })

    it("Não deve aceitar emite_nfce mesmo enviado cru no JSON — continua false", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Loja Tentando Ligar Fiscal", emite_nfce: true },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().emite_nfce).toBe(false)

      const noBanco = await prisma.estabelecimento.findUnique({
        where: { id: loja.id },
      })
      expect(noBanco?.emite_nfce).toBe(false)
    })

    it("Deve retornar 401 sem sessão", async () => {
      const loja = await criarEstabelecimento(CNPJ_NORMALIZADO)

      const response = await app.inject({
        method: "PATCH",
        url: "/estabelecimento/ativo",
        headers: { "x-estabelecimento-id": loja.id },
        payload: { nome: "Sem Sessão" },
      })

      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe("UNAUTHORIZED")
    })
  })
})
