import { beforeEach } from "vitest"
import { prisma } from "./src/lib/prisma"
import { vi } from "vitest"

// Mock do envio de emails no Brevo
vi.mock("./src/lib/brevo", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mocked_message_id" }),
}))

beforeEach(async () => {
  // Limpar os dados antes de cada teste no banco de testes.
  // Ordem filho -> pai: hoje o cascade daria conta sozinho, mas explicitar
  // protege o setup caso algum onDelete mude no schema.
  await prisma.itemVenda.deleteMany()
  await prisma.venda.deleteMany()
  await prisma.turnoCaixa.deleteMany()
  await prisma.movimentacaoEstoque.deleteMany()
  await prisma.produto.deleteMany()
  await prisma.membroEstabelecimento.deleteMany()
  await prisma.estabelecimento.deleteMany()
  await prisma.user.deleteMany()

  vi.clearAllMocks()
})
