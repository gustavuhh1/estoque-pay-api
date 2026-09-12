import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { EstabelecimentoController } from "./controller/EstabelecimentoController"
import { EstabelecimentoService } from "./service/EstabelecimentoService"
import { EstabelecimentoPrismaRepository } from "./repository/EstabelecimentoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  createEstabelecimentoSchema,
  createEstabelecimentoResponseSchema,
} from "./dto/estabelecimento.dto"

export async function estabelecimentoRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositório (Infrastructure)
  const estabelecimentoRepository = new EstabelecimentoPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const estabelecimentoService = new EstabelecimentoService(
    estabelecimentoRepository
  )

  // 3. Instanciar Controller (Presentation)
  const estabelecimentoController = new EstabelecimentoController(
    estabelecimentoService
  )

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Cria um estabelecimento e vincula o criador como OWNER",
        description:
          "RF02.1 e RF02.2: a loja e o vínculo do dono são gravados na mesma transação. O CNPJ é único na plataforma e aceito com ou sem máscara (é normalizado antes de gravar).",
        security: [{ cookieAuth: [] }],
        body: createEstabelecimentoSchema,
        response: {
          201: createEstabelecimentoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          409: errorResponseSchema.describe(
            "CNPJ já cadastrado (code: CNPJ_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => estabelecimentoController.create(req, res)
  )
}
