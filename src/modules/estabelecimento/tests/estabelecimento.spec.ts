import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { CnpjAlreadyInUseError, ForbiddenError } from "@/shared/errors"
import type { Role } from "../../../../generated/prisma/client.js"
import { EstabelecimentoService } from "../service/EstabelecimentoService"
import { EstabelecimentoPrismaRepository } from "../repository/EstabelecimentoPrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"
const TERCEIRO_CNPJ_VALIDO = "11555999000151"

/** O `id` do User não tem default no schema (quem gera é o better-auth). */
async function criarUsuario() {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `owner-${randomUUID()}@email.com`,
      name: "Dono da Loja",
    },
  })
}

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

describe("EstabelecimentoService - Onboarding (RF02.1 / RF02.2)", () => {
  let sut: EstabelecimentoService

  beforeEach(() => {
    sut = new EstabelecimentoService(new EstabelecimentoPrismaRepository(prisma))
  })

  it("Deve criar o estabelecimento e vincular o criador como OWNER", async () => {
    const user = await criarUsuario()

    const result = await sut.create({
      nome: "Mercearia do Zé",
      cnpj: CNPJ_VALIDO,
      ownerId: user.id,
    })

    expect(result.estabelecimento.id).toBeDefined()
    expect(result.membro.role).toBe("OWNER")

    // A prova do RF02.2 está no banco, não no retorno do service.
    const membroNoBanco = await prisma.membroEstabelecimento.findUnique({
      where: {
        userId_estabelecimentoId: {
          userId: user.id,
          estabelecimentoId: result.estabelecimento.id,
        },
      },
    })

    expect(membroNoBanco).not.toBeNull()
    expect(membroNoBanco?.role).toBe("OWNER")
  })

  it("Deve persistir o dado fiscal opcional (IE) informado", async () => {
    const user = await criarUsuario()

    const result = await sut.create({
      nome: "Loja Fiscal",
      cnpj: CNPJ_VALIDO,
      ie: "123456789",
      ownerId: user.id,
    })

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { id: result.estabelecimento.id },
    })

    expect(noBanco?.ie).toBe("123456789")
  })

  it("Deve nascer sempre com emite_nfce = false, mesmo se o cliente tentar mandar outro valor", async () => {
    // emite_nfce não é parâmetro de criação (ver comentário em
    // CreateWithOwnerParams): ligar o switch depende de um pre-check de
    // conformidade (RN01/RN01.1, issue #59) que não existe no onboarding.
    const user = await criarUsuario()

    const result = await sut.create({
      nome: "Loja Recém-Criada",
      cnpj: CNPJ_VALIDO,
      ownerId: user.id,
    })

    expect(result.estabelecimento.emite_nfce).toBe(false)
  })

  it("Deve lançar CnpjAlreadyInUseError quando o CNPJ já existe na plataforma", async () => {
    const primeiroDono = await criarUsuario()
    const segundoDono = await criarUsuario()

    await sut.create({
      nome: "Primeira Loja",
      cnpj: CNPJ_VALIDO,
      ownerId: primeiroDono.id,
    })

    // CNPJ é único na plataforma inteira, não por usuário.
    await expect(
      sut.create({
        nome: "Segunda Loja",
        cnpj: CNPJ_VALIDO,
        ownerId: segundoDono.id,
      })
    ).rejects.toBeInstanceOf(CnpjAlreadyInUseError)
  })

  it("Deve permitir que o mesmo usuário seja dono de mais de uma loja", async () => {
    const user = await criarUsuario()

    await sut.create({
      nome: "Loja A",
      cnpj: CNPJ_VALIDO,
      ownerId: user.id,
    })
    await sut.create({
      nome: "Loja B",
      cnpj: OUTRO_CNPJ_VALIDO,
      ownerId: user.id,
    })

    const vinculos = await prisma.membroEstabelecimento.findMany({
      where: { userId: user.id },
    })

    expect(vinculos).toHaveLength(2)
    expect(vinculos.every((vinculo) => vinculo.role === "OWNER")).toBe(true)
  })

  it("Não deve deixar estabelecimento órfão se o vínculo falhar", async () => {
    // É este teste que justifica a $transaction: sem ela a loja ficaria criada
    // e o insert do membro (FK inválida) falharia depois, deixando lixo no banco.
    await expect(
      sut.create({
        nome: "Loja Órfã",
        cnpj: CNPJ_VALIDO,
        ownerId: randomUUID(), // usuário que não existe -> viola a FK
      })
    ).rejects.toThrow()

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { cnpj: CNPJ_VALIDO },
    })

    expect(noBanco).toBeNull()
  })
})

describe("EstabelecimentoService - Loja Ativa (RF03.1 / RF03.2 / RF04.1 / RF04.2)", () => {
  let sut: EstabelecimentoService

  beforeEach(() => {
    sut = new EstabelecimentoService(new EstabelecimentoPrismaRepository(prisma))
  })

  it("listByUser deve retornar só as lojas do usuário, cada uma com o cargo dele", async () => {
    const user = await criarUsuario()
    const outroUser = await criarUsuario()

    const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
    const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
    const lojaDeOutrem = await criarEstabelecimento(TERCEIRO_CNPJ_VALIDO)

    await criarMembro(user.id, lojaA.id, "OWNER")
    await criarMembro(user.id, lojaB.id, "CASHIER")
    await criarMembro(outroUser.id, lojaDeOutrem.id, "OWNER")

    const resultado = await sut.listByUser(user.id)

    expect(resultado).toHaveLength(2)
    expect(resultado.map((item) => item.estabelecimento.id).sort()).toEqual(
      [lojaA.id, lojaB.id].sort()
    )
    expect(
      resultado.find((item) => item.estabelecimento.id === lojaA.id)?.role
    ).toBe("OWNER")
    expect(
      resultado.find((item) => item.estabelecimento.id === lojaB.id)?.role
    ).toBe("CASHIER")
  })

  it("listByUser deve retornar array vazio se o usuário não tiver vínculo com nenhuma loja", async () => {
    const user = await criarUsuario()

    const resultado = await sut.listByUser(user.id)

    expect(resultado).toEqual([])
  })

  it("getAtivo deve retornar os dados completos da loja, incluindo o certificado_a1", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)
    await prisma.estabelecimento.update({
      where: { id: loja.id },
      data: { certificado_a1: "https://cert.example/a1.pfx" },
    })

    const resultado = await sut.getAtivo(loja.id, "OWNER")

    expect(resultado.nome).toBe(loja.nome)
    expect(resultado.certificado_a1).toBe("https://cert.example/a1.pfx")
    expect(resultado.role).toBe("OWNER")
  })

  it("updateAtivo como OWNER deve atualizar todos os campos cadastrais", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)

    const resultado = await sut.updateAtivo(loja.id, "OWNER", {
      nome: "Novo Nome",
      cnpj: OUTRO_CNPJ_VALIDO,
      ie: "999888777",
      certificado_a1: "https://cert.example/novo.pfx",
      certificado_a1_senha: "senha-cifrada",
    })

    expect(resultado.nome).toBe("Novo Nome")
    expect(resultado.cnpj).toBe(OUTRO_CNPJ_VALIDO)
    expect(resultado.ie).toBe("999888777")
    expect(resultado.certificado_a1).toBe("https://cert.example/novo.pfx")
    expect(resultado.certificado_a1_senha).toBe("senha-cifrada")
  })

  it("updateAtivo como MANAGER deve atualizar campos não-críticos normalmente", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)

    const resultado = await sut.updateAtivo(loja.id, "MANAGER", {
      nome: "Nome Ajustado Pelo Gestor",
      ie: "111222333",
    })

    expect(resultado.nome).toBe("Nome Ajustado Pelo Gestor")
    expect(resultado.ie).toBe("111222333")
  })

  it("updateAtivo como MANAGER tentando alterar cnpj deve ser bloqueado (dado crítico)", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)

    await expect(
      sut.updateAtivo(loja.id, "MANAGER", { cnpj: OUTRO_CNPJ_VALIDO })
    ).rejects.toBeInstanceOf(ForbiddenError)

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { id: loja.id },
    })
    expect(noBanco?.cnpj).toBe(CNPJ_VALIDO)
  })

  it("updateAtivo como MANAGER tentando alterar certificado_a1/certificado_a1_senha deve ser bloqueado", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)

    await expect(
      sut.updateAtivo(loja.id, "MANAGER", {
        certificado_a1: "https://cert.example/tentativa.pfx",
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    await expect(
      sut.updateAtivo(loja.id, "MANAGER", { certificado_a1_senha: "tentativa" })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("updateAtivo como CASHIER deve ser bloqueado mesmo em campos não-críticos", async () => {
    const loja = await criarEstabelecimento(CNPJ_VALIDO)

    await expect(
      sut.updateAtivo(loja.id, "CASHIER", { nome: "Tentativa do Caixa" })
    ).rejects.toBeInstanceOf(ForbiddenError)

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { id: loja.id },
    })
    expect(noBanco?.nome).toBe(loja.nome)
  })

  it("updateAtivo deve lançar CnpjAlreadyInUseError se o CNPJ já pertencer a outra loja", async () => {
    const lojaAlvo = await criarEstabelecimento(CNPJ_VALIDO)
    await criarEstabelecimento(OUTRO_CNPJ_VALIDO)

    await expect(
      sut.updateAtivo(lojaAlvo.id, "OWNER", { cnpj: OUTRO_CNPJ_VALIDO })
    ).rejects.toBeInstanceOf(CnpjAlreadyInUseError)
  })
})
