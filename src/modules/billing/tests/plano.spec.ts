import { describe, it, expect, beforeEach } from "vitest"
import type { Assinatura, StatusAssinatura } from "../../../../generated/prisma/client.js"
import { PlanoLimiteExcedidoError, PlanoRecursoIndisponivelError } from "@/shared/errors"
import { LIMITES_DO_PLANO, PRECO_PREMIUM, TRIAL_DIAS } from "../planos"
import { InMemoryPlanoRepository } from "../repository/InMemoryPlanoRepository"
import { PlanoService } from "../service/PlanoService"

const LOJA = "loja-1"

function assinatura(status: StatusAssinatura): Assinatura {
  return {
    id: "a1",
    estabelecimento_id: LOJA,
    abacatepay_sub_id: null,
    abacatepay_customer_id: null,
    metodo_pagamento_id: null,
    status,
    tipo_plano: "MENSAL",
    trial_expira_em: null,
    periodo_atual_fim: null,
    criado_em: new Date(),
    atualizado_em: new Date(),
  }
}

describe("catálogo de planos (D2 / RN01)", () => {
  it("Free: 50 produtos ativos, 3 membros, CRM restrito e sem NFC-e", () => {
    expect(LIMITES_DO_PLANO.FREE).toEqual({
      produtos_ativos: 50,
      membros: 3,
      crm_completo: false,
      nfce: false,
    })
  })

  it("Premium não tem tetos", () => {
    expect(LIMITES_DO_PLANO.PREMIUM).toEqual({
      produtos_ativos: null,
      membros: null,
      crm_completo: true,
      nfce: true,
    })
  })

  it("preços e trial da D2", () => {
    expect(PRECO_PREMIUM).toEqual({ MENSAL: 30, ANUAL: 299.9 })
    expect(TRIAL_DIAS).toBe(7)
  })
})

describe("PlanoService.obterPlano (#64 — RN00)", () => {
  let repo: InMemoryPlanoRepository
  let sut: PlanoService

  beforeEach(() => {
    repo = new InMemoryPlanoRepository()
    sut = new PlanoService(repo)
  })

  it("loja que nunca assinou é Free", async () => {
    const plano = await sut.obterPlano(LOJA)

    expect(plano.plano).toBe("FREE")
    expect(plano.status).toBeNull()
    expect(plano.limites).toEqual(LIMITES_DO_PLANO.FREE)
  })

  it.each(["TRIALING", "ACTIVE"] as const)("%s é Premium", async (status) => {
    repo.assinaturas.set(LOJA, assinatura(status))

    const plano = await sut.obterPlano(LOJA)

    expect(plano.plano).toBe("PREMIUM")
    expect(plano.status).toBe(status)
    expect(plano.limites).toEqual(LIMITES_DO_PLANO.PREMIUM)
  })

  it.each(["PAST_DUE", "CANCELED"] as const)("%s volta aos limites do Free", async (status) => {
    repo.assinaturas.set(LOJA, assinatura(status))

    const plano = await sut.obterPlano(LOJA)

    expect(plano.plano).toBe("FREE")
    expect(plano.status).toBe(status)
  })

  it("devolve as datas e o ciclo da assinatura", async () => {
    const trial = new Date("2026-11-05T00:00:00Z")
    repo.assinaturas.set(LOJA, {
      ...assinatura("TRIALING"),
      tipo_plano: "ANUAL",
      trial_expira_em: trial,
    })

    const plano = await sut.obterPlano(LOJA)

    expect(plano.tipo_plano).toBe("ANUAL")
    expect(plano.trial_expira_em).toEqual(trial)
  })
})

describe("PlanoService.garantirPodeAtivarProduto (#68 — RN01)", () => {
  let repo: InMemoryPlanoRepository
  let sut: PlanoService

  beforeEach(() => {
    repo = new InMemoryPlanoRepository()
    sut = new PlanoService(repo)
  })

  it("Free com 49 produtos ainda cadastra o 50º", async () => {
    repo.produtosAtivos.set(LOJA, 49)

    await expect(sut.garantirPodeAtivarProduto(LOJA)).resolves.toBeUndefined()
  })

  it("Free com 50 produtos bloqueia o 51º com os números no erro", async () => {
    repo.produtosAtivos.set(LOJA, 50)

    await expect(sut.garantirPodeAtivarProduto(LOJA)).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_LIMITE_PRODUTOS",
      details: { limite: 50, atual: 50 },
    })
    await expect(sut.garantirPodeAtivarProduto(LOJA)).rejects.toBeInstanceOf(
      PlanoLimiteExcedidoError
    )
  })

  it("Premium não tem teto", async () => {
    repo.assinaturas.set(LOJA, assinatura("ACTIVE"))
    repo.produtosAtivos.set(LOJA, 5000)

    await expect(sut.garantirPodeAtivarProduto(LOJA)).resolves.toBeUndefined()
  })

  it("modo restrito (RN03): rebaixado acima do limite não cadastra mais", async () => {
    repo.assinaturas.set(LOJA, assinatura("CANCELED"))
    repo.produtosAtivos.set(LOJA, 80)

    await expect(sut.garantirPodeAtivarProduto(LOJA)).rejects.toMatchObject({
      code: "PLANO_LIMITE_PRODUTOS",
      details: { limite: 50, atual: 80 },
    })
  })
})

describe("PlanoService.garantirPodeAdicionarMembro (#68 — RN01)", () => {
  let repo: InMemoryPlanoRepository
  let sut: PlanoService

  beforeEach(() => {
    repo = new InMemoryPlanoRepository()
    sut = new PlanoService(repo)
  })

  it("Free com Owner + 1 ainda cabe mais um (3º)", async () => {
    repo.membrosEConvites.set(LOJA, 2)

    await expect(sut.garantirPodeAdicionarMembro(LOJA)).resolves.toBeUndefined()
  })

  it("Free com 3 (Owner incluído) bloqueia o 4º", async () => {
    repo.membrosEConvites.set(LOJA, 3)

    await expect(sut.garantirPodeAdicionarMembro(LOJA)).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_LIMITE_MEMBROS",
      details: { limite: 3, atual: 3 },
    })
  })

  it("Premium não tem teto", async () => {
    repo.assinaturas.set(LOJA, assinatura("TRIALING"))
    repo.membrosEConvites.set(LOJA, 40)

    await expect(sut.garantirPodeAdicionarMembro(LOJA)).resolves.toBeUndefined()
  })
})

describe("PlanoService.garantirCamposDoCrm (#68 — RN01)", () => {
  let repo: InMemoryPlanoRepository
  let sut: PlanoService

  beforeEach(() => {
    repo = new InMemoryPlanoRepository()
    sut = new PlanoService(repo)
  })

  it("Free aceita só CPF e Nome (nenhum campo opcional)", async () => {
    await expect(sut.garantirCamposDoCrm(LOJA, {})).resolves.toBeUndefined()
  })

  it.each([
    ["telefone", { telefone: "85999990000" }],
    ["data_nascimento", { data_nascimento: new Date("1990-05-17") }],
    ["observacao", { observacao: "Cliente fiel" }],
  ] as const)("Free bloqueia %s", async (campo, dados) => {
    await expect(sut.garantirCamposDoCrm(LOJA, dados)).rejects.toMatchObject({
      statusCode: 409,
      code: "PLANO_RECURSO_PREMIUM",
      details: { campos: [campo] },
    })
  })

  it("lista todos os campos bloqueados de uma vez", async () => {
    await expect(
      sut.garantirCamposDoCrm(LOJA, { telefone: "85999990000", observacao: "x" })
    ).rejects.toMatchObject({ details: { campos: ["telefone", "observacao"] } })
    await expect(sut.garantirCamposDoCrm(LOJA, { telefone: "85999990000" })).rejects.toBeInstanceOf(
      PlanoRecursoIndisponivelError
    )
  })

  it("null (limpar o campo) sempre passa, para quem foi rebaixado poder apagar", async () => {
    await expect(
      sut.garantirCamposDoCrm(LOJA, { telefone: null, data_nascimento: null, observacao: null })
    ).resolves.toBeUndefined()
  })

  it("Premium libera todos os campos", async () => {
    repo.assinaturas.set(LOJA, assinatura("ACTIVE"))

    await expect(
      sut.garantirCamposDoCrm(LOJA, {
        telefone: "85999990000",
        data_nascimento: new Date("1990-05-17"),
        observacao: "Cliente fiel",
      })
    ).resolves.toBeUndefined()
  })
})
