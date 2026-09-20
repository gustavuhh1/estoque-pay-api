import { beforeEach } from "vitest"
import { prisma } from "./src/lib/prisma"
import { vi } from "vitest"

// Mock do envio de emails no Brevo
vi.mock("./src/lib/brevo", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mocked_message_id" }),
}))

/**
 * Segredo do webhook da AbacatePay (#52). Fixado AQUI, e não no `.env.test`,
 * porque `.env.test` está no .gitignore — quem clonasse o repo rodaria os
 * testes sem a variável e o `createHmac` estouraria com um erro sem relação
 * aparente com o teste. Forçar o valor também deixa a suíte determinística para
 * quem tem um segredo real configurado localmente.
 *
 * Nada aqui toca a rede: a validação de assinatura é crypto puro.
 */
process.env.ABACATEPAY_WEBHOOK_SECRET = "segredo-de-webhook-de-teste"
process.env.ABACATEPAY_API_KEY = "chave-de-teste-nao-usar"

beforeEach(async () => {
  // Limpar os dados antes de cada teste no banco de testes.
  // Ordem filho -> pai: hoje o cascade daria conta sozinho, mas explicitar
  // protege o setup caso algum onDelete mude no schema.
  await prisma.itemVenda.deleteMany()
  await prisma.venda.deleteMany()
  await prisma.turnoCaixa.deleteMany()
  await prisma.movimentacaoEstoque.deleteMany()
  await prisma.produto.deleteMany()
  await prisma.categoria.deleteMany()
  await prisma.membroEstabelecimento.deleteMany()
  await prisma.conviteFuncionario.deleteMany()
  await prisma.estabelecimento.deleteMany()
  await prisma.user.deleteMany()

  vi.clearAllMocks()
})
