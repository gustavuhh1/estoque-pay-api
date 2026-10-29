import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { criarAssinatura } from "@/shared/tests/assinatura"
import { AuthPrismaRepository } from "@/modules/auth/repository/AuthPrismaRepository"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { ProdutoService } from "@/modules/produto/service/ProdutoService"
import { EquipePrismaRepository } from "@/modules/equipe/repository/EquipePrismaRepository"
import { ConvitePrismaRepository } from "@/modules/equipe/repository/ConvitePrismaRepository"
import { EquipeService } from "@/modules/equipe/service/EquipeService"
import { ClientePrismaRepository } from "@/modules/crm/repository/ClientePrismaRepository"
import { ClienteService } from "@/modules/crm/service/ClienteService"
import { PlanoPrismaRepository } from "../repository/PlanoPrismaRepository"
import { PlanoService } from "../service/PlanoService"

/**
 * #68 — o limite do Free aplicado de verdade nos módulos produto, equipe e crm,
 * contra o banco. A regra (50, 3, CPF+Nome) mora no `PlanoService`; aqui se
 * prova que cada módulo o consulta, e que nenhum copiou o número.
 */
const CNPJ = "11222333000181"
const CPF_1 = "52998224725"
const CPF_2 = "11144477735"
const CPF_3 = "39053344705"

async function criarLoja() {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj: CNPJ } })
}

async function criarUsuario(email = `user-${randomUUID()}@email.com`) {
  return prisma.user.create({ data: { id: randomUUID(), email, name: "Usuário" } })
}

async function criarProdutos(estabelecimentoId: string, quantidade: number, ativo = true) {
  await prisma.produto.createMany({
    data: Array.from({ length: quantidade }, (_, i) => ({
      estabelecimento_id: estabelecimentoId,
      nome: `Produto ${ativo ? "ativo" : "inativo"} ${i}`,
      preco_custo: 1,
      preco_venda: 2,
      quantidade_atual: 1,
      ativo,
    })),
  })
}

const novoProduto = (nome = "Produto novo") => ({
  nome,
  tipo_medida: "UNIDADE" as const,
  preco_custo: 1,
  preco_venda: 2,
  quantidade_atual: 1,
  quantidade_minima: 0,
})

describe("Limite de produtos ativos do Free (#68 — RN01/RN03)", () => {
  let sut: ProdutoService

  beforeEach(() => {
    sut = new ProdutoService(
      new ProdutoPrismaRepository(prisma),
      new EstabelecimentoPrismaRepository(prisma),
      new PlanoService(new PlanoPrismaRepository(prisma))
    )
  })

  it("o 50º produto ativo passa e o 51º é bloqueado", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 49)

    await expect(sut.create(loja.id, "OWNER", novoProduto("50º"))).resolves.toMatchObject({
      ativo: true,
    })
    await expect(sut.create(loja.id, "OWNER", novoProduto("51º"))).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_LIMITE_PRODUTOS",
      details: { limite: 50, atual: 50 },
    })
    expect(await prisma.produto.count({ where: { estabelecimento_id: loja.id } })).toBe(50)
  })

  it("produto inativo não conta: 50 ativos + inativos continuam bloqueando só o ativo", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 50)
    await criarProdutos(loja.id, 10, false)

    await expect(sut.create(loja.id, "OWNER", novoProduto())).rejects.toMatchObject({
      code: "PLANO_LIMITE_PRODUTOS",
      details: { atual: 50 },
    })
  })

  it("produto soft deletado não ocupa vaga", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 50)
    const um = await prisma.produto.findFirstOrThrow({ where: { estabelecimento_id: loja.id } })
    await prisma.produto.update({ where: { id: um.id }, data: { deletado_em: new Date() } })

    await expect(sut.create(loja.id, "OWNER", novoProduto())).resolves.toMatchObject({
      ativo: true,
    })
  })

  it("inativar libera a vaga", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 50)
    const um = await prisma.produto.findFirstOrThrow({ where: { estabelecimento_id: loja.id } })

    await sut.inativar(um.id, loja.id, "OWNER")

    await expect(sut.create(loja.id, "OWNER", novoProduto())).resolves.toMatchObject({
      ativo: true,
    })
  })

  it("reativar também respeita o teto", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 50)
    await criarProdutos(loja.id, 1, false)
    const inativo = await prisma.produto.findFirstOrThrow({
      where: { estabelecimento_id: loja.id, ativo: false },
    })

    await expect(sut.reativar(inativo.id, loja.id, "OWNER")).rejects.toMatchObject({
      code: "PLANO_LIMITE_PRODUTOS",
    })
    const depois = await prisma.produto.findUniqueOrThrow({ where: { id: inativo.id } })
    expect(depois.ativo).toBe(false)
  })

  it("reativar quem já está ativo não se conta duas vezes", async () => {
    const loja = await criarLoja()
    await criarProdutos(loja.id, 50)
    const ativo = await prisma.produto.findFirstOrThrow({
      where: { estabelecimento_id: loja.id, ativo: true },
    })

    await expect(sut.reativar(ativo.id, loja.id, "OWNER")).resolves.toMatchObject({
      ativo: true,
    })
  })

  it("produto que nasce inativo pela RN09.1 não ocupa vaga e passa mesmo no teto", async () => {
    const loja = await prisma.estabelecimento.create({
      data: { nome: "Loja Fiscal", cnpj: CNPJ, emite_nfce: true },
    })
    await criarProdutos(loja.id, 50)

    // Sem NCM/CFOP com NFC-e ligada: nasce inativo (nunca bloqueia o save).
    await expect(sut.create(loja.id, "OWNER", novoProduto())).resolves.toMatchObject({
      ativo: false,
    })
  })

  it("Premium não tem teto", async () => {
    const loja = await criarLoja()
    await criarAssinatura(loja.id, "ACTIVE")
    await criarProdutos(loja.id, 60)

    await expect(sut.create(loja.id, "OWNER", novoProduto())).resolves.toMatchObject({
      ativo: true,
    })
  })

  it("modo restrito (RN03): assinatura cancelada com 60 ativos não cadastra, mas inativa", async () => {
    const loja = await criarLoja()
    await criarAssinatura(loja.id, "CANCELED")
    await criarProdutos(loja.id, 60)

    await expect(sut.create(loja.id, "OWNER", novoProduto())).rejects.toMatchObject({
      code: "PLANO_LIMITE_PRODUTOS",
      details: { atual: 60 },
    })

    // Não perde o acesso: segue listando e inativando o que já tem.
    expect(await sut.list(loja.id, "OWNER")).toHaveLength(60)
    const um = await prisma.produto.findFirstOrThrow({ where: { estabelecimento_id: loja.id } })
    await expect(sut.inativar(um.id, loja.id, "OWNER")).resolves.toMatchObject({ ativo: false })
  })

  it("o limite é por loja", async () => {
    const lojaCheia = await criarLoja()
    const outra = await prisma.estabelecimento.create({
      data: { nome: "Outra", cnpj: "11444777000161" },
    })
    await criarProdutos(lojaCheia.id, 50)

    await expect(sut.create(outra.id, "OWNER", novoProduto())).resolves.toBeDefined()
  })
})

describe("Limite de membros do Free (#68 — RN01/RN03)", () => {
  let sut: EquipeService

  beforeEach(() => {
    sut = new EquipeService(
      new EquipePrismaRepository(prisma),
      new ConvitePrismaRepository(prisma),
      new AuthPrismaRepository(prisma),
      new EstabelecimentoPrismaRepository(prisma),
      new PlanoService(new PlanoPrismaRepository(prisma))
    )
  })

  async function lojaComOwner() {
    const loja = await criarLoja()
    const owner = await criarUsuario()
    await prisma.membroEstabelecimento.create({
      data: { userId: owner.id, estabelecimentoId: loja.id, role: "OWNER" },
    })
    return { loja, owner }
  }

  it("Owner + 2 caixas cabem (3); o 4º vinculado é bloqueado", async () => {
    const { loja, owner } = await lojaComOwner()
    const a = await criarUsuario()
    const b = await criarUsuario()
    const c = await criarUsuario()

    await sut.cadastrar(loja.id, "OWNER", owner.id, { email: a.email, role: "CASHIER" })
    await sut.cadastrar(loja.id, "OWNER", owner.id, { email: b.email, role: "CASHIER" })

    await expect(
      sut.cadastrar(loja.id, "OWNER", owner.id, { email: c.email, role: "CASHIER" })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_LIMITE_MEMBROS",
      details: { limite: 3, atual: 3 },
    })
    expect(
      await prisma.membroEstabelecimento.count({ where: { estabelecimentoId: loja.id } })
    ).toBe(3)
  })

  it("convite pendente ocupa vaga: Owner + 1 membro + 1 convite = 3, o 4º convite é bloqueado", async () => {
    const { loja, owner } = await lojaComOwner()
    const a = await criarUsuario()

    await sut.cadastrar(loja.id, "OWNER", owner.id, { email: a.email, role: "CASHIER" })
    await sut.cadastrar(loja.id, "OWNER", owner.id, {
      email: "sem-conta-1@email.com",
      role: "CASHIER",
    })

    await expect(
      sut.cadastrar(loja.id, "OWNER", owner.id, {
        email: "sem-conta-2@email.com",
        role: "CASHIER",
      })
    ).rejects.toMatchObject({ code: "PLANO_LIMITE_MEMBROS" })
    expect(await prisma.conviteFuncionario.count()).toBe(1)
  })

  it("reenviar convite para quem já foi convidado não é barrado por contar a si mesmo", async () => {
    const { loja, owner } = await lojaComOwner()
    const a = await criarUsuario()
    await sut.cadastrar(loja.id, "OWNER", owner.id, { email: a.email, role: "CASHIER" })
    await sut.cadastrar(loja.id, "OWNER", owner.id, {
      email: "sem-conta@email.com",
      role: "CASHIER",
    })

    // Loja cheia (3). Reenviar o MESMO convite só o atualiza.
    await expect(
      sut.cadastrar(loja.id, "OWNER", owner.id, {
        email: "sem-conta@email.com",
        role: "CASHIER",
      })
    ).resolves.toMatchObject({ status: "CONVITE_ENVIADO" })
    expect(await prisma.conviteFuncionario.count()).toBe(1)
  })

  it("Premium não tem teto de membros", async () => {
    const { loja, owner } = await lojaComOwner()
    await criarAssinatura(loja.id, "TRIALING")

    for (let i = 0; i < 5; i++) {
      const u = await criarUsuario()
      await sut.cadastrar(loja.id, "OWNER", owner.id, { email: u.email, role: "CASHIER" })
    }

    expect(
      await prisma.membroEstabelecimento.count({ where: { estabelecimentoId: loja.id } })
    ).toBe(6)
  })

  it("editar o cargo e remover membros continuam livres no modo restrito", async () => {
    const { loja, owner } = await lojaComOwner()
    await criarAssinatura(loja.id, "PAST_DUE")
    const a = await criarUsuario()
    const b = await criarUsuario()
    // Loja já passou do limite (4), por ter sido Premium.
    await prisma.membroEstabelecimento.createMany({
      data: [
        { userId: a.id, estabelecimentoId: loja.id, role: "CASHIER" },
        { userId: b.id, estabelecimentoId: loja.id, role: "CASHIER" },
        { userId: (await criarUsuario()).id, estabelecimentoId: loja.id, role: "CASHIER" },
      ],
    })
    const membro = await prisma.membroEstabelecimento.findFirstOrThrow({
      where: { estabelecimentoId: loja.id, userId: a.id },
    })

    await expect(
      sut.editar(loja.id, "OWNER", membro.id, { role: "MANAGER" })
    ).resolves.toBeDefined()
    await expect(
      sut.cadastrar(loja.id, "OWNER", owner.id, {
        email: (await criarUsuario()).email,
        role: "CASHIER",
      })
    ).rejects.toMatchObject({ code: "PLANO_LIMITE_MEMBROS" })
  })
})

describe("CRM restrito a CPF e Nome no Free (#68 — RN01)", () => {
  let sut: ClienteService

  beforeEach(() => {
    sut = new ClienteService(
      new ClientePrismaRepository(prisma),
      new PlanoService(new PlanoPrismaRepository(prisma))
    )
  })

  it("Free cadastra só com CPF e Nome", async () => {
    const loja = await criarLoja()

    const cliente = await sut.create(loja.id, { nome: "Maria Souza", cpf: CPF_1 })

    expect(cliente.telefone).toBeNull()
    expect(cliente.observacao).toBeNull()
  })

  it.each([
    ["telefone", { telefone: "85999990000" }],
    ["data_nascimento", { data_nascimento: new Date("1990-05-17") }],
    ["observacao", { observacao: "Prefere pão sem sal" }],
  ] as const)("Free recusa %s no cadastro e nada é gravado", async (campo, extra) => {
    const loja = await criarLoja()

    await expect(
      sut.create(loja.id, { nome: "Maria Souza", cpf: CPF_1, ...extra })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_RECURSO_PREMIUM",
      details: { campos: [campo] },
    })
    expect(await prisma.cliente.count()).toBe(0)
  })

  it("Free recusa preencher campo extra na edição, mas aceita editar o nome", async () => {
    const loja = await criarLoja()
    const cliente = await sut.create(loja.id, { nome: "Maria Souza", cpf: CPF_2 })

    await expect(
      sut.update(cliente.id, loja.id, { telefone: "85999990000" })
    ).rejects.toMatchObject({ code: "PLANO_RECURSO_PREMIUM" })
    await expect(
      sut.update(cliente.id, loja.id, { nome: "Maria S. Souza" })
    ).resolves.toMatchObject({ nome: "Maria S. Souza" })
  })

  it("quem foi rebaixado ainda consegue LIMPAR os campos (null) e continua lendo os dados", async () => {
    const loja = await criarLoja()
    await criarAssinatura(loja.id, "ACTIVE")
    const cliente = await sut.create(loja.id, {
      nome: "Maria Souza",
      cpf: CPF_3,
      telefone: "85999990000",
      observacao: "Cliente fiel",
    })
    await prisma.assinatura.update({
      where: { estabelecimento_id: loja.id },
      data: { status: "CANCELED" },
    })

    // Dados existentes seguem visíveis (a loja não perde acesso).
    await expect(sut.findById(cliente.id, loja.id)).resolves.toMatchObject({
      telefone: "85999990000",
    })
    await expect(
      sut.update(cliente.id, loja.id, { telefone: null, observacao: null })
    ).resolves.toMatchObject({ telefone: null, observacao: null })
  })

  it("Premium usa todos os campos", async () => {
    const loja = await criarLoja()
    await criarAssinatura(loja.id, "TRIALING")

    const cliente = await sut.create(loja.id, {
      nome: "Maria Souza",
      cpf: CPF_1,
      telefone: "85999990000",
      data_nascimento: new Date("1990-05-17"),
      observacao: "Cliente fiel",
    })

    expect(cliente.telefone).toBe("85999990000")
  })
})
