import { describe, it, expect, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/brevo"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({ data: { userId, estabelecimentoId, role } })
}

describe("Equipe Module - E2E (DB Real)", () => {
  describe("POST /equipe (#41)", () => {
    it("201 — vincula direto quando o e-mail já tem conta, sem disparar e-mail", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const { user: funcionario } = await createAuthenticatedUser()

      const response = await app.inject({
        method: "POST",
        url: "/equipe",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { email: funcionario.email, role: "CASHIER" },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().role).toBe("CASHIER")
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it("202 — cria convite pendente e dispara e-mail quando o e-mail não tem conta", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const emailConvidado = `novo-${randomUUID()}@email.com`

      const response = await app.inject({
        method: "POST",
        url: "/equipe",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { email: emailConvidado, role: "MANAGER" },
      })

      expect(response.statusCode).toBe(202)
      expect(response.json().email).toBe(emailConvidado)
      expect(sendEmail).toHaveBeenCalledTimes(1)
    })

    it("403 — Caixa não pode cadastrar funcionário", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/equipe",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { email: "x@email.com", role: "CASHIER" },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_EQUIPE")
    })

    it("fluxo completo de convite: quem se cadastra depois com o mesmo e-mail é vinculado automaticamente", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const emailConvidado = `convite-${randomUUID()}@email.com`

      const conviteResponse = await app.inject({
        method: "POST",
        url: "/equipe",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { email: emailConvidado, role: "CASHIER" },
      })
      expect(conviteResponse.statusCode).toBe(202)

      const registerResponse = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: emailConvidado, password: "password123", name: "Convidado" },
      })
      expect(registerResponse.statusCode).toBe(201)

      const novoUsuario = await prisma.user.findUniqueOrThrow({ where: { email: emailConvidado } })
      const membro = await prisma.membroEstabelecimento.findUnique({
        where: { userId_estabelecimentoId: { userId: novoUsuario.id, estabelecimentoId: loja.id } },
      })
      expect(membro?.role).toBe("CASHIER")

      const convite = await prisma.conviteFuncionario.findUnique({
        where: { email_estabelecimentoId: { email: emailConvidado, estabelecimentoId: loja.id } },
      })
      expect(convite?.aceitoEm).not.toBeNull()
    })
  })

  describe("GET /equipe (#41)", () => {
    it("200 — lista membros e convites pendentes", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "GET",
        url: "/equipe",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().membros).toHaveLength(1)
    })
  })

  describe("PATCH /equipe/:id (#42)", () => {
    it("200 — edita o cargo de um funcionário", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const { user: funcionario } = await createAuthenticatedUser()
      const membro = await criarMembro(funcionario.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "PATCH",
        url: `/equipe/${membro.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { role: "MANAGER" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().role).toBe("MANAGER")
    })

    it("404 — funcionário não encontrado nesta loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "PATCH",
        url: `/equipe/${randomUUID()}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { role: "MANAGER" },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe("DELETE /equipe/:id (#42)", () => {
    it("204 — remove o funcionário e derruba a sessão dele", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      await criarMembro(user.id, loja.id, "OWNER")
      const { user: funcionario } = await createAuthenticatedUser()
      const membro = await criarMembro(funcionario.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "DELETE",
        url: `/equipe/${membro.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(204)

      const sessoes = await prisma.session.findMany({ where: { userId: funcionario.id } })
      expect(sessoes).toHaveLength(0)
    })

    it("403 — não é possível excluir o último Owner da loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento()
      const membroOwner = await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "DELETE",
        url: `/equipe/${membroOwner.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("LAST_OWNER_CANNOT_BE_REMOVED")
    })
  })
})
