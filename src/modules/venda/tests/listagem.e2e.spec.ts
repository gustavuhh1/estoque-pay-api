import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role, StatusPagamento } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarOperador(lojaId: string, role: Role) {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { user, cookie }
}

async function criarVenda(
  lojaId: string,
  usuarioId: string,
  overrides: Partial<{
    total: number
    taxa: number
    status: StatusPagamento
    criada_em: Date
  }> = {}
) {
  return prisma.venda.create({
    data: {
      estabelecimento_id: lojaId,
      usuario_id: usuarioId,
      total_venda: overrides.total ?? 10,
      taxa_split: overrides.taxa ?? null,
      metodo_pagamento: overrides.taxa ? "PIX_ABACATEPAY" : "DINHEIRO",
      status_pagamento: overrides.status ?? "PAGO",
      ...(overrides.criada_em && { criada_em: overrides.criada_em }),
    },
  })
}

function listar(cookie: string, lojaId: string, query = "") {
  return app.inject({
    method: "GET",
    url: `/venda${query}`,
    headers: { cookie, "x-estabelecimento-id": lojaId },
  })
}

describe("GET /venda — histórico de vendas", () => {
  it("200 — Owner vê a loja inteira, mais recentes primeiro, com total cobrado", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")
    const caixa = await criarOperador(loja.id, "CASHIER")
    await criarVenda(loja.id, caixa.user.id, { total: 10, criada_em: new Date("2026-10-01T10:00:00Z") })
    await criarVenda(loja.id, owner.user.id, {
      total: 20,
      taxa: 0.8,
      criada_em: new Date("2026-10-02T10:00:00Z"),
    })

    const response = await listar(owner.cookie, loja.id)

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.total).toBe(2)
    expect(body.pagina).toBe(1)
    expect(body.limite).toBe(20)
    expect(body.itens.map((v: { total_venda: number }) => v.total_venda)).toEqual([20, 10])
    // D1: o que o consumidor pagou = itens + taxa do Pix.
    expect(body.itens[0].total_cobrado).toBe(20.8)
    expect(body.itens[1].total_cobrado).toBe(10)
  })

  it("200 — Gestor também vê a loja inteira", async () => {
    const loja = await criarEstabelecimento()
    const gestor = await criarOperador(loja.id, "MANAGER")
    const caixa = await criarOperador(loja.id, "CASHIER")
    await criarVenda(loja.id, caixa.user.id)

    const response = await listar(gestor.cookie, loja.id)

    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(1)
  })

  it("200 — Caixa vê só as vendas que ele registrou", async () => {
    const loja = await criarEstabelecimento()
    const caixa = await criarOperador(loja.id, "CASHIER")
    const colega = await criarOperador(loja.id, "CASHIER")
    const dele = await criarVenda(loja.id, caixa.user.id)
    await criarVenda(loja.id, colega.user.id)

    const response = await listar(caixa.cookie, loja.id)

    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(1)
    expect(response.json().itens[0].id).toBe(dele.id)
  })

  it("200 — não vaza venda de outra loja", async () => {
    const loja = await criarEstabelecimento()
    const outra = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
    const owner = await criarOperador(loja.id, "OWNER")
    const dono = await criarOperador(outra.id, "OWNER")
    await criarVenda(outra.id, dono.user.id)

    const response = await listar(owner.cookie, loja.id)

    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(0)
    expect(response.json().itens).toEqual([])
  })

  it("200 — filtra por status", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")
    await criarVenda(loja.id, owner.user.id, { status: "PAGO" })
    await criarVenda(loja.id, owner.user.id, { status: "CANCELADO" })
    await criarVenda(loja.id, owner.user.id, { status: "PENDENTE", taxa: 0.8 })

    const response = await listar(owner.cookie, loja.id, "?status=PENDENTE")

    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(1)
    expect(response.json().itens[0].status_pagamento).toBe("PENDENTE")
  })

  it("200 — filtra por período (de e ate, inclusivos)", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")
    await criarVenda(loja.id, owner.user.id, { criada_em: new Date("2026-09-30T23:00:00Z") })
    await criarVenda(loja.id, owner.user.id, { criada_em: new Date("2026-10-15T12:00:00Z") })
    await criarVenda(loja.id, owner.user.id, { criada_em: new Date("2026-11-02T12:00:00Z") })

    const response = await listar(
      owner.cookie,
      loja.id,
      "?de=2026-10-01T00:00:00Z&ate=2026-10-31T23:59:59Z"
    )

    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(1)
  })

  it("200 — pagina sem repetir nem perder venda, e total ignora a paginação", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")
    const mesmoInstante = new Date("2026-10-10T10:00:00Z")
    for (let i = 0; i < 5; i++) {
      await criarVenda(loja.id, owner.user.id, { criada_em: mesmoInstante })
    }

    const p1 = (await listar(owner.cookie, loja.id, "?limite=2&pagina=1")).json()
    const p2 = (await listar(owner.cookie, loja.id, "?limite=2&pagina=2")).json()
    const p3 = (await listar(owner.cookie, loja.id, "?limite=2&pagina=3")).json()

    expect(p1.total).toBe(5)
    expect([p1.itens.length, p2.itens.length, p3.itens.length]).toEqual([2, 2, 1])
    const ids = [...p1.itens, ...p2.itens, ...p3.itens].map((v: { id: string }) => v.id)
    expect(new Set(ids).size).toBe(5)
  })

  it("400 — início do período depois do fim", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")

    const response = await listar(
      owner.cookie,
      loja.id,
      "?de=2026-10-31T00:00:00Z&ate=2026-10-01T00:00:00Z"
    )

    expect(response.statusCode).toBe(400)
  })

  it("400 — limite acima de 100 e status inválido", async () => {
    const loja = await criarEstabelecimento()
    const owner = await criarOperador(loja.id, "OWNER")

    expect((await listar(owner.cookie, loja.id, "?limite=101")).statusCode).toBe(400)
    expect((await listar(owner.cookie, loja.id, "?status=XPTO")).statusCode).toBe(400)
  })

  it("400 — sem o header da loja", async () => {
    const { cookie } = await createAuthenticatedUser()

    const response = await app.inject({ method: "GET", url: "/venda", headers: { cookie } })

    expect(response.statusCode).toBe(400)
  })

  it("401 — sem sessão", async () => {
    const loja = await criarEstabelecimento()

    const response = await app.inject({
      method: "GET",
      url: "/venda",
      headers: { "x-estabelecimento-id": loja.id },
    })

    expect(response.statusCode).toBe(401)
  })

  it("403 — usuário sem vínculo com a loja", async () => {
    const loja = await criarEstabelecimento()
    const { cookie } = await createAuthenticatedUser()

    const response = await listar(cookie, loja.id)

    expect(response.statusCode).toBe(403)
  })
})
