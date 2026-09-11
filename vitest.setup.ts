import { beforeEach } from "vitest"
import { prisma } from "./src/lib/prisma"
import { resend } from "./src/lib/resend"
import { vi } from "vitest"

// Mock do envio de emails no Resend
vi.mock("./src/lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ id: "mocked_email_id" }),
    },
  },
}))

beforeEach(async () => {
  // Limpar os dados antes de cada teste no banco de testes
  await prisma.user.deleteMany()
  // As demais tabelas em cascata também serão deletadas dependendo do relacionamento
  // Para ser completo, podemos deletar as que não tem cascade ou simplesmente limpar o banco todo:
  await prisma.estabelecimento.deleteMany()
  
  vi.clearAllMocks()
})
