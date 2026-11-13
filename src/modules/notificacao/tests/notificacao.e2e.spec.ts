import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { InMemoryPagamentoGateway } from "@/modules/pagamento/gateway/InMemoryPagamentoGateway"
import {
  criarContexto,
  iniciarPix,
  montarApp,
} from "@/modules/pagamento/tests/pix-helpers"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarLoja(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarOperador(lojaId: string, role: Role = "OWNER") {
  const { user, cookie } = await createAuthenticatedUser()
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: lojaId, role },
  })
  return { user, cookie, headers: { cookie, "x-estabelecimento-id": lojaId } }
}

async function criarProduto(lojaId: string, quantidade_atual: number, quantidade_minima: number) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: lojaId,
      nome: "Arroz 5kg",
      preco_custo: 10,
      preco_venda: 25,
      quantidade_atual,
      quantidade_minima,
    },
  })
}

async function listar(headers: Record<string, string>) {
  return app.inject({ method: "GET", url: "/notificacao", headers })
}

describe("Notificação - E2E (DB Real)", () => {
  describe("gatilhos", () => {
    it("venda paga que cruza o mínimo gera ESTOQUE_BAIXO uma vez; cancelamento gera VENDA_CANCELADA", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id)
      const produto = await criarProduto(loja.id, 6, 5)
      await app.inject({ method: "POST", url: "/caixa/turno", headers, payload: { valor_abertura: 100 } })

      const vender = (quantidade: number) =>
        app.inject({
          method: "POST",
          url: "/pagamento",
          headers,
          payload: {
            itens: [{ produto_id: produto.id, quantidade }],
            metodo_pagamento: "DEBITO",
          },
        })

      const primeira = await vender(2) // 6 -> 4: cruza o mínimo 5
      expect(primeira.statusCode).toBe(201)
      await vender(1) // 4 -> 3: já estava abaixo, não repete

      let response = await listar(headers)
      expect(response.statusCode).toBe(200)
      expect(response.json().nao_lidas).toBe(1)
      expect(response.json().itens[0]).toMatchObject({
        tipo: "ESTOQUE_BAIXO",
        titulo: "Estoque baixo: Arroz 5kg",
        link: "/estoque",
        lida: false,
      })
      expect(response.json().itens[0]).not.toHaveProperty("chave")

      const cancelamento = await app.inject({
        method: "POST",
        url: `/venda/${primeira.json().venda_id}/cancelar`,
        headers,
      })
      expect(cancelamento.statusCode).toBe(200)

      response = await listar(headers)
      expect(response.json().nao_lidas).toBe(2)
      expect(response.json().itens[0]).toMatchObject({
        tipo: "VENDA_CANCELADA",
        mensagem: "Uma venda de R$ 50,00 (1 item) foi cancelada e os produtos voltaram ao estoque.",
      })
    })

    it("saída manual que zera o estoque gera ESTOQUE_ZERADO", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id, "MANAGER")
      const produto = await criarProduto(loja.id, 2, 1)

      const saida = await app.inject({
        method: "POST",
        url: "/estoque/movimentacao",
        headers,
        payload: { produto_id: produto.id, quantidade: 2, tipo: "SAIDA", motivo: "PERDA" },
      })
      expect(saida.statusCode).toBe(201)

      const response = await listar(headers)
      expect(response.json().itens.map((n: { tipo: string }) => n.tipo)).toEqual(["ESTOQUE_ZERADO"])
    })

    it("fechamento com diferença gera CAIXA_DIFERENCA", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id, "CASHIER")
      await app.inject({ method: "POST", url: "/caixa/turno", headers, payload: { valor_abertura: 100 } })

      const fechamento = await app.inject({
        method: "PATCH",
        url: "/caixa/turno/atual",
        headers,
        payload: { valor_fechamento: 90 },
      })
      expect(fechamento.statusCode).toBe(200)

      const response = await listar(headers)
      expect(response.json().itens[0]).toMatchObject({
        tipo: "CAIXA_DIFERENCA",
        titulo: "Falta no fechamento do caixa",
        mensagem: "Esperado R$ 100,00, contado R$ 90,00: falta de R$ 10,00.",
      })
    })

    it("fechamento que bate não notifica", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id)
      await app.inject({ method: "POST", url: "/caixa/turno", headers, payload: { valor_abertura: 100 } })
      await app.inject({ method: "PATCH", url: "/caixa/turno/atual", headers, payload: { valor_fechamento: 100 } })

      expect((await listar(headers)).json().nao_lidas).toBe(0)
    })

    it("Pix confirmado gera PIX_CONFIRMADO uma única vez, mesmo com polling repetido", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const pixApp = await montarApp(gateway)
      const ctx = await criarContexto()
      const { payment_id } = (await iniciarPix(pixApp, ctx)).json()
      gateway.definirStatus(payment_id, "PAID")

      for (let i = 0; i < 2; i++) {
        await pixApp.inject({
          method: "GET",
          url: `/pagamento/pix/${payment_id}/status`,
          headers: ctx.headers,
        })
      }

      const notificacoes = await prisma.notificacao.findMany({
        where: { estabelecimento_id: ctx.lojaId },
      })
      expect(notificacoes.map((n) => n.tipo)).toEqual(["PIX_CONFIRMADO"])
      expect(notificacoes[0]!.mensagem).toBe("Pagamento de R$ 10,07 recebido via Pix.")
    })
  })

  describe("leitura", () => {
    async function semear(lojaId: string, titulos: string[]) {
      for (const titulo of titulos) {
        await prisma.notificacao.create({
          data: { estabelecimento_id: lojaId, tipo: "PIX_CONFIRMADO", titulo, mensagem: titulo },
        })
      }
    }

    it("PATCH /:id/lida marca uma; PATCH /lidas marca o resto", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id, "CASHIER")
      await semear(loja.id, ["a", "b", "c"])
      const [primeira] = (await listar(headers)).json().itens

      const uma = await app.inject({
        method: "PATCH",
        url: `/notificacao/${primeira.id}/lida`,
        headers,
      })
      expect(uma.statusCode).toBe(200)
      expect(uma.json().lida).toBe(true)
      expect((await listar(headers)).json().nao_lidas).toBe(2)

      const todas = await app.inject({ method: "PATCH", url: "/notificacao/lidas", headers })
      expect(todas.statusCode).toBe(200)
      expect(todas.json().atualizadas).toBe(2)
      expect((await listar(headers)).json().nao_lidas).toBe(0)
    })

    it("respeita o limite e ordena das mais recentes para as mais antigas", async () => {
      const loja = await criarLoja()
      const { headers } = await criarOperador(loja.id)
      await semear(loja.id, ["antiga", "nova"])

      const response = await app.inject({ method: "GET", url: "/notificacao?limite=1", headers })

      expect(response.json().itens).toHaveLength(1)
      expect(response.json().itens[0].titulo).toBe("nova")
      expect(response.json().nao_lidas).toBe(2)
    })

    it("isola por loja: não lista nem marca notificação de outra loja (404)", async () => {
      const loja = await criarLoja()
      const outra = await criarLoja(OUTRO_CNPJ_VALIDO)
      const { headers } = await criarOperador(loja.id)
      await semear(outra.id, ["de outra loja"])
      const alheia = await prisma.notificacao.findFirstOrThrow({ where: { estabelecimento_id: outra.id } })

      expect((await listar(headers)).json()).toEqual({ itens: [], nao_lidas: 0 })

      const response = await app.inject({
        method: "PATCH",
        url: `/notificacao/${alheia.id}/lida`,
        headers,
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().code).toBe("NOTIFICACAO_NAO_ENCONTRADA")
    })

    it("401 sem sessão e 400 sem header de loja", async () => {
      expect((await app.inject({ method: "GET", url: "/notificacao" })).statusCode).toBe(401)

      const { cookie } = await createAuthenticatedUser()
      const semLoja = await app.inject({ method: "GET", url: "/notificacao", headers: { cookie } })
      expect(semLoja.statusCode).toBe(400)
    })
  })
})
