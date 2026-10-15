import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { ClienteCpfAlreadyInUseError, NotFoundError } from "@/shared/errors"
import { createClienteSchema } from "../dto/cliente.dto"
import { ClientePrismaRepository } from "../repository/ClientePrismaRepository"
import { ClienteService } from "../service/ClienteService"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"
const CPF_VALIDO = "52998224725"
const OUTRO_CPF_VALIDO = "11144477735"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarClienteDireto(
  estabelecimentoId: string,
  overrides: Partial<{ nome: string; cpf: string }> = {}
) {
  return prisma.cliente.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Cliente de Teste",
      cpf: overrides.cpf ?? CPF_VALIDO,
    },
  })
}

describe("createClienteSchema (#57 — validação de CPF)", () => {
  it("normaliza o CPF mascarado para só dígitos", () => {
    const resultado = createClienteSchema.parse({ nome: "Maria", cpf: "529.982.247-25" })

    expect(resultado.cpf).toBe(CPF_VALIDO)
  })

  it("rejeita CPF com dígito verificador errado", () => {
    const resultado = createClienteSchema.safeParse({ nome: "Maria", cpf: "52998224726" })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.issues[0]?.path).toEqual(["cpf"])
  })

  it("rejeita CPF de dígitos repetidos", () => {
    expect(createClienteSchema.safeParse({ nome: "Maria", cpf: "11111111111" }).success).toBe(false)
  })

  it("rejeita data de nascimento no futuro", () => {
    const resultado = createClienteSchema.safeParse({
      nome: "Maria",
      cpf: CPF_VALIDO,
      data_nascimento: "2999-01-01",
    })

    expect(resultado.success).toBe(false)
  })

  it("converte a data de nascimento AAAA-MM-DD em Date", () => {
    const resultado = createClienteSchema.parse({
      nome: "Maria",
      cpf: CPF_VALIDO,
      data_nascimento: "1990-05-17",
    })

    expect(resultado.data_nascimento).toBeInstanceOf(Date)
  })
})

describe("ClienteService (#57 — RF01.1 a RF01.4)", () => {
  let sut: ClienteService

  beforeEach(() => {
    sut = new ClienteService(new ClientePrismaRepository(prisma))
  })

  describe("create (RF01.1)", () => {
    it("salva os dados obrigatórios e os opcionais", async () => {
      const loja = await criarEstabelecimento()

      const cliente = await sut.create(loja.id, {
        nome: "Maria Souza",
        cpf: CPF_VALIDO,
        telefone: "85999998888",
        data_nascimento: new Date("1990-05-17"),
        observacao: "Prefere contato por WhatsApp.",
      })

      const noBanco = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } })
      expect(noBanco.estabelecimento_id).toBe(loja.id)
      expect(noBanco.cpf).toBe(CPF_VALIDO)
      expect(noBanco.telefone).toBe("85999998888")
      expect(noBanco.data_nascimento?.toISOString()).toBe("1990-05-17T00:00:00.000Z")
      expect(noBanco.observacao).toBe("Prefere contato por WhatsApp.")
      expect(noBanco.pontos_fidelidade).toBe(0)
    })

    it("aceita cadastro só com CPF e nome", async () => {
      const loja = await criarEstabelecimento()

      const cliente = await sut.create(loja.id, { nome: "João", cpf: CPF_VALIDO })

      expect(cliente.telefone).toBeNull()
      expect(cliente.data_nascimento).toBeNull()
      expect(cliente.observacao).toBeNull()
    })

    it("bloqueia CPF que já existe na mesma loja", async () => {
      const loja = await criarEstabelecimento()
      await criarClienteDireto(loja.id, { cpf: CPF_VALIDO })

      await expect(
        sut.create(loja.id, { nome: "Duplicado", cpf: CPF_VALIDO })
      ).rejects.toBeInstanceOf(ClienteCpfAlreadyInUseError)

      expect(await prisma.cliente.count()).toBe(1)
    })

    it("permite o mesmo CPF em lojas diferentes (unique é por tenant)", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarClienteDireto(lojaA.id, { cpf: CPF_VALIDO })

      const cliente = await sut.create(lojaB.id, { nome: "Mesma Pessoa", cpf: CPF_VALIDO })

      expect(cliente.estabelecimento_id).toBe(lojaB.id)
    })

    it("cadastros simultâneos do mesmo CPF: um passa e o outro é 409, nunca 500", async () => {
      const loja = await criarEstabelecimento()

      const resultados = await Promise.allSettled([
        sut.create(loja.id, { nome: "A", cpf: CPF_VALIDO }),
        sut.create(loja.id, { nome: "B", cpf: CPF_VALIDO }),
      ])

      const rejeitados = resultados.filter((r) => r.status === "rejected")
      expect(rejeitados).toHaveLength(1)
      expect((rejeitados[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ClienteCpfAlreadyInUseError
      )
    })
  })

  describe("list (RF01.2)", () => {
    it("lista só os clientes da loja, em ordem alfabética", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarClienteDireto(lojaA.id, { nome: "Zélia", cpf: CPF_VALIDO })
      await criarClienteDireto(lojaA.id, { nome: "Ana", cpf: OUTRO_CPF_VALIDO })
      await criarClienteDireto(lojaB.id, { nome: "Intrusa", cpf: CPF_VALIDO })

      const resultado = await sut.list(lojaA.id, { page: 1, limit: 20 })

      expect(resultado.total).toBe(2)
      expect(resultado.data.map((cliente) => cliente.nome)).toEqual(["Ana", "Zélia"])
    })

    it("busca parcial pelo nome, sem diferenciar maiúsculas", async () => {
      const loja = await criarEstabelecimento()
      await criarClienteDireto(loja.id, { nome: "Maria Souza", cpf: CPF_VALIDO })
      await criarClienteDireto(loja.id, { nome: "João Lima", cpf: OUTRO_CPF_VALIDO })

      const resultado = await sut.list(loja.id, { busca: "souz", page: 1, limit: 20 })

      expect(resultado.data.map((cliente) => cliente.nome)).toEqual(["Maria Souza"])
    })

    it("busca pelo início do CPF, mesmo digitado com máscara", async () => {
      const loja = await criarEstabelecimento()
      await criarClienteDireto(loja.id, { nome: "Maria", cpf: CPF_VALIDO })
      await criarClienteDireto(loja.id, { nome: "João", cpf: OUTRO_CPF_VALIDO })

      const resultado = await sut.list(loja.id, { busca: "529.982", page: 1, limit: 20 })

      expect(resultado.data.map((cliente) => cliente.nome)).toEqual(["Maria"])
    })

    it("pagina devolvendo o total da loja", async () => {
      const loja = await criarEstabelecimento()
      await criarClienteDireto(loja.id, { nome: "Ana", cpf: CPF_VALIDO })
      await criarClienteDireto(loja.id, { nome: "Bia", cpf: OUTRO_CPF_VALIDO })

      const resultado = await sut.list(loja.id, { page: 2, limit: 1 })

      expect(resultado.total).toBe(2)
      expect(resultado.data.map((cliente) => cliente.nome)).toEqual(["Bia"])
    })
  })

  describe("findById (RF01.3)", () => {
    it("devolve o cliente com as observações", async () => {
      const loja = await criarEstabelecimento()
      const criado = await sut.create(loja.id, {
        nome: "Maria",
        cpf: CPF_VALIDO,
        observacao: "Cliente desde a inauguração.",
      })

      const cliente = await sut.findById(criado.id, loja.id)

      expect(cliente.observacao).toBe("Cliente desde a inauguração.")
    })

    it("cliente de outra loja é indistinguível de inexistente", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const daLojaB = await criarClienteDireto(lojaB.id)

      await expect(sut.findById(daLojaB.id, lojaA.id)).rejects.toBeInstanceOf(NotFoundError)
      await expect(sut.findById(randomUUID(), lojaA.id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe("update (RF01.4)", () => {
    it("atualiza parcialmente e limpa opcionais com null", async () => {
      const loja = await criarEstabelecimento()
      const criado = await sut.create(loja.id, {
        nome: "Maria",
        cpf: CPF_VALIDO,
        telefone: "85999998888",
      })

      const atualizado = await sut.update(criado.id, loja.id, {
        nome: "Maria Souza",
        telefone: null,
      })

      expect(atualizado.nome).toBe("Maria Souza")
      expect(atualizado.telefone).toBeNull()
      expect(atualizado.cpf).toBe(CPF_VALIDO)
    })

    it("bloqueia trocar para um CPF já usado por outro cliente da loja", async () => {
      const loja = await criarEstabelecimento()
      await criarClienteDireto(loja.id, { cpf: CPF_VALIDO })
      const alvo = await criarClienteDireto(loja.id, { cpf: OUTRO_CPF_VALIDO })

      await expect(
        sut.update(alvo.id, loja.id, { cpf: CPF_VALIDO })
      ).rejects.toBeInstanceOf(ClienteCpfAlreadyInUseError)
    })

    it("reenviar o próprio CPF não conta como duplicidade", async () => {
      const loja = await criarEstabelecimento()
      const cliente = await criarClienteDireto(loja.id, { cpf: CPF_VALIDO })

      const atualizado = await sut.update(cliente.id, loja.id, { cpf: CPF_VALIDO })

      expect(atualizado.cpf).toBe(CPF_VALIDO)
    })

    it("não edita cliente de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const daLojaB = await criarClienteDireto(lojaB.id, { nome: "Original" })

      await expect(
        sut.update(daLojaB.id, lojaA.id, { nome: "Invasão" })
      ).rejects.toBeInstanceOf(NotFoundError)

      const noBanco = await prisma.cliente.findUniqueOrThrow({ where: { id: daLojaB.id } })
      expect(noBanco.nome).toBe("Original")
    })
  })
})
