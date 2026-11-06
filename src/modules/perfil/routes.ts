import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { errorResponseSchema } from "@/shared/errors/schema"
import { PerfilController } from "./controller/PerfilController"
import { perfilResponseSchema, updatePerfilSchema } from "./dto/perfil.dto"
import { PerfilPrismaRepository } from "./repository/PerfilPrismaRepository"
import { PerfilService } from "./service/PerfilService"

/** RF01.7 (Meu perfil). Não depende de loja: vale para a pessoa em qualquer estabelecimento. */
export async function perfilRoutes(app: FastifyInstance) {
  const controller = new PerfilController(new PerfilService(new PerfilPrismaRepository(prisma)))
  const route = app.withTypeProvider<ZodTypeProvider>()
  const naoAutenticado = errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)")

  route.get(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Perfil"],
        summary: "Dados pessoais de quem está logado",
        description:
          "RF01.7: nome, e-mail, foto, formas de login e as lojas em que a pessoa tem vínculo, com o cargo em cada uma.",
        security: [{ cookieAuth: [] }],
        response: { 200: perfilResponseSchema, 401: naoAutenticado },
      },
    },
    async (req, res) => controller.buscar(req, res)
  )

  route.patch(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Perfil"],
        summary: "Edita o nome e a foto",
        description:
          "RF01.7: `foto` é um data URI PNG, JPEG ou WebP de até ~100 KB (o front reduz a imagem para 256 px antes de enviar). `foto: null` remove a foto.",
        security: [{ cookieAuth: [] }],
        body: updatePerfilSchema,
        response: {
          200: perfilResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: naoAutenticado,
        },
      },
    },
    async (req, res) => controller.atualizar(req, res)
  )

  route.post(
    "/foto/google",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Perfil"],
        summary: "Troca a foto pela do Google",
        description: "RF01.7: usa a foto da conta Google vinculada, mesmo que já exista uma foto enviada.",
        security: [{ cookieAuth: [] }],
        response: {
          200: perfilResponseSchema,
          401: naoAutenticado,
          409: errorResponseSchema.describe("Sem conta Google com foto (code: FOTO_GOOGLE_INDISPONIVEL)"),
        },
      },
    },
    async (req, res) => controller.usarFotoDoGoogle(req, res)
  )
}
