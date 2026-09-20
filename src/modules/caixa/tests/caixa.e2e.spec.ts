import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({
    data: { userId, estabelecimentoId, role },
  })
}

/** Cria usuário autenticado já vinculado a uma loja no cargo informado. */
async function criarOperador(lojaId: string, role: Role) {
  const { user, cookie } = await createAuthenticatedUser()
  await criarMembro(user.id, lojaId, role)
  return { user, cookie }
}

describe("Caixa Module - E2E (DB Real)", () => {
  describe("POST /caixa/turno (#54 — RF06.1)", () => {
    it("201 — abre o turno creditando quem abriu", async () => {
      const loja = await criarEstabelecimento()
      const { user, cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().status).toBe("ABERTO")
      expect(response.json().aberto_por_id).toBe(user.id)
      expect(response.json().aberto_por_nome).toBe(user.name)
      expect(response.json().valor_abertura).toBe(200)
      expect(response.json().fechado_por_id).toBeNull()
    })

    it("201 — CASHIER pode abrir o turno (decisão que substitui a RN04 original)", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 150 },
      })

      expect(response.statusCode).toBe(201)
    })

    it("409 — a loja já possui turno aberto", async () => {
      const loja = await criarEstabelecimento()
      const primeiro = await criarOperador(loja.id, "MANAGER")
      const segundo = await criarOperador(loja.id, "CASHIER")

      await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie: primeiro.cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie: segundo.cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 300 },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("TURNO_JA_ABERTO")
    })

    it("400 — valor de abertura negativo", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: -10 },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("400 — valor com mais de 2 casas decimais", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 10.555 },
      })

      expect(response.statusCode).toBe(400)
    })

    it("400 — sem o header x-estabelecimento-id", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie },
        payload: { valor_abertura: 200 },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento()

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe("UNAUTHORIZED")
    })

    it("403 — usuário sem vínculo com a loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const { cookie } = await criarOperador(outraLoja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe("GET /caixa/turno/atual (#54)", () => {
    it("200 — devolve o turno aberto", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      const response = await app.inject({
        method: "GET",
        url: "/caixa/turno/atual",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().status).toBe("ABERTO")
      expect(response.json().valor_abertura).toBe(200)
    })

    it("404 — caixa fechado", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "GET",
        url: "/caixa/turno/atual",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("TURNO_NAO_ENCONTRADO")
    })
  })

  describe("PATCH /caixa/turno/atual (#54 — RF06.2)", () => {
    it("200 — fecha registrando quem fechou, diferente de quem abriu", async () => {
      const loja = await criarEstabelecimento()
      const abriu = await criarOperador(loja.id, "MANAGER")
      const fechou = await criarOperador(loja.id, "CASHIER")

      await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie: abriu.cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })

      const response = await app.inject({
        method: "PATCH",
        url: "/caixa/turno/atual",
        headers: { cookie: fechou.cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_fechamento: 1250.55 },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().status).toBe("FECHADO")
      expect(response.json().aberto_por_id).toBe(abriu.user.id)
      expect(response.json().fechado_por_id).toBe(fechou.user.id)
      expect(response.json().valor_fechamento).toBe(1250.55)
      expect(response.json().valor_abertura).toBe(200)
    })

    it("404 — fechar sem turno aberto", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: "/caixa/turno/atual",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_fechamento: 500 },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("TURNO_NAO_ENCONTRADO")
    })

    it("201 — reabre o caixa depois de fechar o turno anterior", async () => {
      const loja = await criarEstabelecimento()
      const { cookie } = await criarOperador(loja.id, "OWNER")

      await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 200 },
      })
      await app.inject({
        method: "PATCH",
        url: "/caixa/turno/atual",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_fechamento: 900 },
      })

      const response = await app.inject({
        method: "POST",
        url: "/caixa/turno",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { valor_abertura: 120 },
      })

      expect(response.statusCode).toBe(201)
      expect(await prisma.turnoCaixa.count()).toBe(2)
    })
  })
})
