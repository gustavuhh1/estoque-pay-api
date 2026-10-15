import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"
const CPF_VALIDO = "52998224725"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarMembroLogado(lojaId: string, role: Role = "OWNER") {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { user, cookie, headers: { cookie, "x-estabelecimento-id": lojaId } }
}

const CORPO_BASE = {
  nome: "Maria Souza",
  cpf: "529.982.247-25",
  telefone: "85999998888",
  data_nascimento: "1990-05-17",
  observacao: "Prefere contato por WhatsApp.",
}

describe("CRM - Clientes E2E (#57)", () => {
  describe("POST /crm/clientes (RF01.1)", () => {
    it("201 — cadastra com os opcionais e devolve o CPF normalizado", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(201)
      const json = response.json()
      expect(json.cpf).toBe(CPF_VALIDO)
      expect(json.telefone).toBe("85999998888")
      expect(json.data_nascimento).toBe("1990-05-17T00:00:00.000Z")
      expect(json.observacao).toBe("Prefere contato por WhatsApp.")
      expect(json.pontos_fidelidade).toBe(0)
    })

    it("201 — CASHIER pode cadastrar (é quem identifica o cliente no balcão)", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: { nome: "João", cpf: CPF_VALIDO },
      })

      expect(response.statusCode).toBe(201)
    })

    it("400 — CPF inválido aponta o campo cpf", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: { ...CORPO_BASE, cpf: "529.982.247-26" },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
      expect(
        response.json().details.issues.map((issue: { field: string }) => issue.field)
      ).toContain("cpf")
    })

    it("400 — data de nascimento fora do formato AAAA-MM-DD", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: { ...CORPO_BASE, data_nascimento: "17/05/1990" },
      })

      expect(response.statusCode).toBe(400)
    })

    it("409 — CPF já cadastrado na loja, mesmo com outra máscara", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)
      await prisma.cliente.create({
        data: { estabelecimento_id: loja.id, nome: "Já Existe", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("CLIENTE_CPF_ALREADY_IN_USE")
      expect(response.json().details.field).toBe("cpf")
    })

    it("201 — o mesmo CPF em outra loja é permitido", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const { headers } = await criarMembroLogado(lojaB.id)
      await prisma.cliente.create({
        data: { estabelecimento_id: lojaA.id, nome: "Na Loja A", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers,
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(201)
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers: { "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(401)
    })

    it("403 — sem vínculo com a loja", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await createAuthenticatedUser()

      const response = await app.inject({
        method: "POST",
        url: "/crm/clientes",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("TENANT_ACCESS_DENIED")
    })
  })

  describe("GET /crm/clientes (RF01.2)", () => {
    it("200 — lista paginada só com os clientes da loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const { headers } = await criarMembroLogado(lojaA.id)
      await prisma.cliente.create({
        data: { estabelecimento_id: lojaA.id, nome: "Da Loja A", cpf: CPF_VALIDO },
      })
      await prisma.cliente.create({
        data: { estabelecimento_id: lojaB.id, nome: "Da Loja B", cpf: CPF_VALIDO },
      })

      const response = await app.inject({ method: "GET", url: "/crm/clientes", headers })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ total: 1, page: 1, limit: 20 })
      expect(response.json().data[0].nome).toBe("Da Loja A")
    })

    it("200 — busca pelo nome", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)
      await prisma.cliente.create({
        data: { estabelecimento_id: loja.id, nome: "Maria Souza", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "GET",
        url: "/crm/clientes?busca=maria",
        headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(1)
    })

    it("400 — limit acima do teto", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)

      const response = await app.inject({
        method: "GET",
        url: "/crm/clientes?limit=500",
        headers,
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe("GET /crm/clientes/:id (RF01.3)", () => {
    it("200 — detalha o cliente", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)
      const cliente = await prisma.cliente.create({
        data: {
          estabelecimento_id: loja.id,
          nome: "Maria",
          cpf: CPF_VALIDO,
          observacao: "Alérgica a amendoim.",
        },
      })

      const response = await app.inject({
        method: "GET",
        url: `/crm/clientes/${cliente.id}`,
        headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().observacao).toBe("Alérgica a amendoim.")
    })

    it("404 — cliente de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const { headers } = await criarMembroLogado(lojaA.id)
      const daLojaB = await prisma.cliente.create({
        data: { estabelecimento_id: lojaB.id, nome: "Outra", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "GET",
        url: `/crm/clientes/${daLojaB.id}`,
        headers,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("CLIENTE_NAO_ENCONTRADO")
    })
  })

  describe("PATCH /crm/clientes/:id (RF01.4)", () => {
    it("200 — atualiza e persiste", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)
      const cliente = await prisma.cliente.create({
        data: { estabelecimento_id: loja.id, nome: "Maria", cpf: CPF_VALIDO, telefone: "85999998888" },
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/crm/clientes/${cliente.id}`,
        headers,
        payload: { nome: "Maria Souza", telefone: null },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().nome).toBe("Maria Souza")
      expect(response.json().telefone).toBeNull()
    })

    it("400 — body vazio", async () => {
      const loja = await criarEstabelecimento()
      const { headers } = await criarMembroLogado(loja.id)
      const cliente = await prisma.cliente.create({
        data: { estabelecimento_id: loja.id, nome: "Maria", cpf: CPF_VALIDO },
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/crm/clientes/${cliente.id}`,
        headers,
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
