import { describe, it, expect, beforeEach, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/brevo"
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors"
import { AuthPrismaRepository } from "@/modules/auth/repository/AuthPrismaRepository"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import type { Role } from "../../../../generated/prisma/client.js"
import { EquipeService } from "../service/EquipeService"
import { vincularConvitesPendentes } from "../service/vincularConvitesPendentes"
import { EquipePrismaRepository } from "../repository/EquipePrismaRepository"
import { ConvitePrismaRepository } from "../repository/ConvitePrismaRepository"

const CNPJ_VALIDO = "11222333000181"

async function criarUsuario(email = `user-${randomUUID()}@email.com`) {
  return prisma.user.create({
    data: { id: randomUUID(), email, name: "Usuário de Teste" },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({ data: { userId, estabelecimentoId, role } })
}

describe("EquipeService", () => {
  let sut: EquipeService

  beforeEach(() => {
    sut = new EquipeService(
      new EquipePrismaRepository(prisma),
      new ConvitePrismaRepository(prisma),
      new AuthPrismaRepository(prisma),
      new EstabelecimentoPrismaRepository(prisma)
    )
  })

  describe("cadastrar (#41 — RF05.1 / RN01)", () => {
    it("vincula direto e sem e-mail quando o usuário já tem conta", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const funcionario = await criarUsuario()

      const resultado = await sut.cadastrar(loja.id, "OWNER", owner.id, {
        email: funcionario.email,
        role: "CASHIER",
      })

      expect(resultado.status).toBe("VINCULADO")
      expect(sendEmail).not.toHaveBeenCalled()

      const membro = await prisma.membroEstabelecimento.findUnique({
        where: { userId_estabelecimentoId: { userId: funcionario.id, estabelecimentoId: loja.id } },
      })
      expect(membro?.role).toBe("CASHIER")
    })

    it("cria convite pendente e envia e-mail quando o e-mail ainda não tem conta", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const emailConvidado = `novo-${randomUUID()}@email.com`

      const resultado = await sut.cadastrar(loja.id, "OWNER", owner.id, {
        email: emailConvidado,
        role: "MANAGER",
      })

      expect(resultado.status).toBe("CONVITE_ENVIADO")
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(vi.mocked(sendEmail).mock.calls[0]?.[0]).toMatchObject({ to: emailConvidado })

      const convite = await prisma.conviteFuncionario.findUnique({
        where: { email_estabelecimentoId: { email: emailConvidado, estabelecimentoId: loja.id } },
      })
      expect(convite?.role).toBe("MANAGER")
      expect(convite?.aceitoEm).toBeNull()
    })

    it("403 — Caixa não pode cadastrar funcionário", async () => {
      const loja = await criarEstabelecimento()
      const caixa = await criarUsuario()
      await criarMembro(caixa.id, loja.id, "CASHIER")

      await expect(
        sut.cadastrar(loja.id, "CASHIER", caixa.id, { email: "x@email.com", role: "CASHIER" })
      ).rejects.toThrow(ForbiddenError)
    })

    it("403 — Gestor só pode atribuir o cargo Caixa", async () => {
      const loja = await criarEstabelecimento()
      const gestor = await criarUsuario()
      await criarMembro(gestor.id, loja.id, "MANAGER")

      await expect(
        sut.cadastrar(loja.id, "MANAGER", gestor.id, { email: "x@email.com", role: "MANAGER" })
      ).rejects.toMatchObject({ code: "ROLE_CANNOT_ASSIGN_ROLE" })
    })

    it("permite Gestor cadastrar um Caixa", async () => {
      const loja = await criarEstabelecimento()
      const gestor = await criarUsuario()
      await criarMembro(gestor.id, loja.id, "MANAGER")
      const novoFuncionario = await criarUsuario()

      const resultado = await sut.cadastrar(loja.id, "MANAGER", gestor.id, {
        email: novoFuncionario.email,
        role: "CASHIER",
      })

      expect(resultado.status).toBe("VINCULADO")
    })

    it("409 — usuário já faz parte da equipe desta loja", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const funcionario = await criarUsuario()
      await criarMembro(funcionario.id, loja.id, "CASHIER")

      await expect(
        sut.cadastrar(loja.id, "OWNER", owner.id, { email: funcionario.email, role: "CASHIER" })
      ).rejects.toThrow(ConflictError)
    })
  })

  describe("listar (#41 — RF05.2)", () => {
    it("lista membros e convites pendentes da loja", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      await prisma.conviteFuncionario.create({
        data: {
          email: "pendente@email.com",
          estabelecimentoId: loja.id,
          role: "CASHIER",
          criadoPorId: owner.id,
        },
      })

      const resultado = await sut.listar(loja.id, "OWNER")

      expect(resultado.membros).toHaveLength(1)
      expect(resultado.convitesPendentes).toHaveLength(1)
    })

    it("403 — Caixa não pode listar a equipe", async () => {
      const loja = await criarEstabelecimento()
      await expect(sut.listar(loja.id, "CASHIER")).rejects.toThrow(ForbiddenError)
    })
  })

  describe("editar (#42 — RF05.3 / RN02 / RN03 estendida)", () => {
    it("Owner edita o cargo de um Caixa normalmente", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const funcionario = await criarUsuario()
      const membro = await criarMembro(funcionario.id, loja.id, "CASHIER")

      const atualizado = await sut.editar(loja.id, "OWNER", membro.id, { role: "MANAGER" })

      expect(atualizado.role).toBe("MANAGER")
    })

    it("403 — Gestor não pode editar um Owner (RN02)", async () => {
      const loja = await criarEstabelecimento()
      const gestor = await criarUsuario()
      await criarMembro(gestor.id, loja.id, "MANAGER")
      const outroOwner = await criarUsuario()
      const membroOwner = await criarMembro(outroOwner.id, loja.id, "OWNER")

      await expect(
        sut.editar(loja.id, "MANAGER", membroOwner.id, { role: "CASHIER" })
      ).rejects.toMatchObject({ code: "ROLE_CANNOT_EDIT_OWNER" })
    })

    it("403 — Gestor não pode promover um Caixa a Gestor", async () => {
      const loja = await criarEstabelecimento()
      const gestor = await criarUsuario()
      await criarMembro(gestor.id, loja.id, "MANAGER")
      const funcionario = await criarUsuario()
      const membro = await criarMembro(funcionario.id, loja.id, "CASHIER")

      await expect(
        sut.editar(loja.id, "MANAGER", membro.id, { role: "MANAGER" })
      ).rejects.toMatchObject({ code: "ROLE_CANNOT_ASSIGN_ROLE" })
    })

    it("403 — não permite rebaixar o último Owner da loja", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      const membroOwner = await criarMembro(owner.id, loja.id, "OWNER")

      await expect(
        sut.editar(loja.id, "OWNER", membroOwner.id, { role: "MANAGER" })
      ).rejects.toMatchObject({ code: "LAST_OWNER_CANNOT_BE_REMOVED" })
    })

    it("permite rebaixar um Owner quando existe outro Owner na loja", async () => {
      const loja = await criarEstabelecimento()
      const owner1 = await criarUsuario()
      await criarMembro(owner1.id, loja.id, "OWNER")
      const owner2 = await criarUsuario()
      const membroOwner2 = await criarMembro(owner2.id, loja.id, "OWNER")

      const atualizado = await sut.editar(loja.id, "OWNER", membroOwner2.id, { role: "MANAGER" })

      expect(atualizado.role).toBe("MANAGER")
    })

    it("404 — funcionário de outra loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento("11444777000161")
      const funcionario = await criarUsuario()
      const membro = await criarMembro(funcionario.id, outraLoja.id, "CASHIER")

      await expect(sut.editar(loja.id, "OWNER", membro.id, { role: "MANAGER" })).rejects.toThrow(
        NotFoundError
      )
    })
  })

  describe("excluir (#42 — RF05.4 / RN02 / RN03 / RN06)", () => {
    it("remove o vínculo e revoga as sessões do funcionário", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const funcionario = await criarUsuario()
      const membro = await criarMembro(funcionario.id, loja.id, "CASHIER")
      await prisma.session.create({
        data: {
          id: randomUUID(),
          token: randomUUID(),
          userId: funcionario.id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })

      await sut.excluir(loja.id, "OWNER", membro.id)

      const membroRestante = await prisma.membroEstabelecimento.findUnique({ where: { id: membro.id } })
      expect(membroRestante).toBeNull()

      const sessoes = await prisma.session.findMany({ where: { userId: funcionario.id } })
      expect(sessoes).toHaveLength(0)
    })

    it("403 — Gestor não pode excluir um Owner", async () => {
      const loja = await criarEstabelecimento()
      const gestor = await criarUsuario()
      await criarMembro(gestor.id, loja.id, "MANAGER")
      const outroOwner = await criarUsuario()
      const membroOwner = await criarMembro(outroOwner.id, loja.id, "OWNER")

      await expect(sut.excluir(loja.id, "MANAGER", membroOwner.id)).rejects.toMatchObject({
        code: "ROLE_CANNOT_EDIT_OWNER",
      })
    })

    it("403 — não permite excluir o último Owner da loja", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      const membroOwner = await criarMembro(owner.id, loja.id, "OWNER")

      await expect(sut.excluir(loja.id, "OWNER", membroOwner.id)).rejects.toMatchObject({
        code: "LAST_OWNER_CANNOT_BE_REMOVED",
      })
    })
  })

  describe("vincularConvitesPendentes (hook de cadastro, ver src/lib/auth.ts)", () => {
    it("cria o vínculo e marca o convite como aceito quando o usuário se cadastra", async () => {
      const loja = await criarEstabelecimento()
      const owner = await criarUsuario()
      await criarMembro(owner.id, loja.id, "OWNER")
      const email = `convidado-${randomUUID()}@email.com`
      const convite = await prisma.conviteFuncionario.create({
        data: { email, estabelecimentoId: loja.id, role: "MANAGER", criadoPorId: owner.id },
      })

      const novoUsuario = await criarUsuario(email)
      await vincularConvitesPendentes(prisma, { id: novoUsuario.id, email })

      const membro = await prisma.membroEstabelecimento.findUnique({
        where: { userId_estabelecimentoId: { userId: novoUsuario.id, estabelecimentoId: loja.id } },
      })
      expect(membro?.role).toBe("MANAGER")

      const conviteAtualizado = await prisma.conviteFuncionario.findUnique({
        where: { id: convite.id },
      })
      expect(conviteAtualizado?.aceitoEm).not.toBeNull()
    })

    it("não faz nada quando não há convite pendente para o e-mail", async () => {
      const usuario = await criarUsuario()

      await expect(
        vincularConvitesPendentes(prisma, { id: usuario.id, email: usuario.email })
      ).resolves.toBeUndefined()
    })
  })
})
