import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import {
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { errorHandler } from "@/shared/middlewares/error-handler"
import { pagamentoRoutes } from "../routes"
import { InMemoryPagamentoGateway } from "../gateway/InMemoryPagamentoGateway"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"

/**
 * Monta uma app só com o módulo de pagamento, injetando o gateway dublê.
 * A app principal (`@/app`) usa o AbacatePayGateway real, que tocaria a rede
 * nestes endpoints — diferente do webhook, cuja validação é crypto local.
 */
async function montarApp(gateway: InMemoryPagamentoGateway) {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  await app.register(pagamentoRoutes(gateway), { prefix: "/pagamento" })
  await app.ready()
  return app
}

async function criarContexto() {
  const { user, cookie } = await createAuthenticatedUser()
  const loja = await prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj: CNPJ_VALIDO },
  })
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: loja.id, role: "CASHIER" as Role },
  })
  return { cookie, lojaId: loja.id }
}

async function criarCobranca(gateway: InMemoryPagamentoGateway) {
  const cobranca = await gateway.criarCobrancaPix({
    valor: 100,
    descricao: "Venda de teste",
    expira_em_segundos: 3600,
    venda_id: "venda-1",
  })
  return cobranca.payment_id
}

describe("Rotas de Pix - E2E (#52)", () => {
  describe("GET /pagamento/pix/:payment_id/status", () => {
    it("200 — devolve PENDING antes do pagamento", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const { cookie, lojaId } = await criarContexto()
      const paymentId = await criarCobranca(gateway)

      const response = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers: { cookie, "x-estabelecimento-id": lojaId },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().status).toBe("PENDING")
      expect(response.json().pago).toBe(false)
    })

    it("200 — Caixa pode consultar (é quem opera o PDV)", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const { cookie, lojaId } = await criarContexto()
      const paymentId = await criarCobranca(gateway)

      // O contexto acima cria o membro já com o cargo CASHIER.
      const response = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers: { cookie, "x-estabelecimento-id": lojaId },
      })

      expect(response.statusCode).toBe(200)
    })

    it("401 — sem sessão", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const paymentId = await criarCobranca(gateway)

      const response = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
      })

      expect(response.statusCode).toBe(401)
    })

    it("400 — sem o header de loja", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const { cookie } = await criarContexto()
      const paymentId = await criarCobranca(gateway)

      const response = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
    })
  })

  describe("POST /pagamento/pix/:payment_id/simular-pagamento", () => {
    it("200 — marca como PAGA e o polling passa a ver pago: true", async () => {
      const gateway = new InMemoryPagamentoGateway()
      const app = await montarApp(gateway)
      const { cookie, lojaId } = await criarContexto()
      const paymentId = await criarCobranca(gateway)
      const headers = { cookie, "x-estabelecimento-id": lojaId }

      const antes = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers,
      })
      expect(antes.json().pago).toBe(false)

      const simulacao = await app.inject({
        method: "POST",
        url: `/pagamento/pix/${paymentId}/simular-pagamento`,
        headers,
      })
      expect(simulacao.statusCode).toBe(200)
      expect(simulacao.json().pago).toBe(true)

      const depois = await app.inject({
        method: "GET",
        url: `/pagamento/pix/${paymentId}/status`,
        headers,
      })
      expect(depois.json().status).toBe("PAID")
      expect(depois.json().pago).toBe(true)
    })

    it("NÃO é registrada quando NODE_ENV=production", async () => {
      // A trava que impede a rota de existir em produção mesmo se alguém
      // esquecer de comentar o bloco ao mesclar para a main.
      const original = process.env.NODE_ENV
      process.env.NODE_ENV = "production"

      try {
        const gateway = new InMemoryPagamentoGateway()
        const app = await montarApp(gateway)
        const { cookie, lojaId } = await criarContexto()
        const paymentId = await criarCobranca(gateway)

        const response = await app.inject({
          method: "POST",
          url: `/pagamento/pix/${paymentId}/simular-pagamento`,
          headers: { cookie, "x-estabelecimento-id": lojaId },
        })

        expect(response.statusCode).toBe(404)
      } finally {
        process.env.NODE_ENV = original
      }
    })

    it("a rota de status continua existindo em produção", async () => {
      // Só a de simulação é condicional — o polling é fluxo normal.
      const original = process.env.NODE_ENV
      process.env.NODE_ENV = "production"

      try {
        const gateway = new InMemoryPagamentoGateway()
        const app = await montarApp(gateway)
        const { cookie, lojaId } = await criarContexto()
        const paymentId = await criarCobranca(gateway)

        const response = await app.inject({
          method: "GET",
          url: `/pagamento/pix/${paymentId}/status`,
          headers: { cookie, "x-estabelecimento-id": lojaId },
        })

        expect(response.statusCode).toBe(200)
      } finally {
        process.env.NODE_ENV = original
      }
    })
  })
})
