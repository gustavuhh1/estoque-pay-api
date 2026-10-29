import Fastify from "fastify"
import {
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { errorHandler } from "@/shared/middlewares/error-handler"
import { pagamentoRoutes } from "../routes"
import type { InMemoryPagamentoGateway } from "../gateway/InMemoryPagamentoGateway"
import type { Role } from "../../../../generated/prisma/client.js"

/** Auxiliares dos e2e do fluxo Pix (criação, polling e webhook). */
export const CNPJ_VALIDO = "11222333000181"
export const CNPJ_OUTRA_LOJA = "11444777000161"

/**
 * Monta uma app só com o módulo de pagamento, injetando o gateway dublê.
 * A app principal (`@/app`) usa o AbacatePayGateway real, que tocaria a rede
 * nestes endpoints — diferente do webhook, cuja validação é crypto local.
 */
export async function montarApp(gateway: InMemoryPagamentoGateway) {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  await app.register(pagamentoRoutes(gateway), { prefix: "/pagamento" })
  await app.ready()
  return app
}

/** Loja com um Caixa autenticado, turno aberto e um produto de R$ 10,07. */
export async function criarContexto(options: { turnoAberto?: boolean; cnpj?: string } = {}) {
  const { user, cookie } = await createAuthenticatedUser()
  const loja = await prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj: options.cnpj ?? CNPJ_VALIDO },
  })
  await prisma.membroEstabelecimento.create({
    data: { userId: user.id, estabelecimentoId: loja.id, role: "CASHIER" as Role },
  })

  if (options.turnoAberto !== false) {
    await prisma.turnoCaixa.create({
      data: { estabelecimento_id: loja.id, aberto_por_id: user.id, valor_abertura: 100 },
    })
  }

  // 10.07 de propósito: em float, 10.07 + 0.8 não dá 10.87 exato.
  const produto = await prisma.produto.create({
    data: {
      estabelecimento_id: loja.id,
      nome: "Produto",
      preco_custo: 5,
      preco_venda: 10.07,
      quantidade_atual: 10,
      quantidade_minima: 0,
    },
  })

  return {
    cookie,
    lojaId: loja.id,
    produtoId: produto.id,
    headers: { cookie, "x-estabelecimento-id": loja.id },
  }
}

export async function iniciarPix(
  app: Awaited<ReturnType<typeof montarApp>>,
  ctx: Awaited<ReturnType<typeof criarContexto>>,
  body: Record<string, unknown> = {}
) {
  return app.inject({
    method: "POST",
    url: "/pagamento/pix",
    headers: ctx.headers,
    payload: { itens: [{ produto_id: ctx.produtoId, quantidade: 1 }], ...body },
  })
}

export async function estoqueDe(produtoId: string) {
  const produto = await prisma.produto.findUniqueOrThrow({ where: { id: produtoId } })
  return Number(produto.quantidade_atual)
}
