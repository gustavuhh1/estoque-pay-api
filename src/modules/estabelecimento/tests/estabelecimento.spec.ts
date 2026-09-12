import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { CnpjAlreadyInUseError } from "@/shared/errors"
import { EstabelecimentoService } from "../service/EstabelecimentoService"
import { EstabelecimentoPrismaRepository } from "../repository/EstabelecimentoPrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

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
      emite_nfce: false,
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

  it("Deve persistir os dados fiscais opcionais informados", async () => {
    const user = await criarUsuario()

    const result = await sut.create({
      nome: "Loja Fiscal",
      cnpj: CNPJ_VALIDO,
      ie: "123456789",
      emite_nfce: true,
      ownerId: user.id,
    })

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { id: result.estabelecimento.id },
    })

    expect(noBanco?.ie).toBe("123456789")
    expect(noBanco?.emite_nfce).toBe(true)
  })

  it("Deve lançar CnpjAlreadyInUseError quando o CNPJ já existe na plataforma", async () => {
    const primeiroDono = await criarUsuario()
    const segundoDono = await criarUsuario()

    await sut.create({
      nome: "Primeira Loja",
      cnpj: CNPJ_VALIDO,
      emite_nfce: false,
      ownerId: primeiroDono.id,
    })

    // CNPJ é único na plataforma inteira, não por usuário.
    await expect(
      sut.create({
        nome: "Segunda Loja",
        cnpj: CNPJ_VALIDO,
        emite_nfce: false,
        ownerId: segundoDono.id,
      })
    ).rejects.toBeInstanceOf(CnpjAlreadyInUseError)
  })

  it("Deve permitir que o mesmo usuário seja dono de mais de uma loja", async () => {
    const user = await criarUsuario()

    await sut.create({
      nome: "Loja A",
      cnpj: CNPJ_VALIDO,
      emite_nfce: false,
      ownerId: user.id,
    })
    await sut.create({
      nome: "Loja B",
      cnpj: OUTRO_CNPJ_VALIDO,
      emite_nfce: false,
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
        emite_nfce: false,
        ownerId: randomUUID(), // usuário que não existe -> viola a FK
      })
    ).rejects.toThrow()

    const noBanco = await prisma.estabelecimento.findUnique({
      where: { cnpj: CNPJ_VALIDO },
    })

    expect(noBanco).toBeNull()
  })
})
