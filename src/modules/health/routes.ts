import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import z from "zod"
import { prisma } from "@/lib/prisma"

/**
 * Healthcheck do Docker e da hospedagem (Etapa 4). Rota PÚBLICA de propósito:
 * quem a chama é o orquestrador, sem sessão. Não expõe dado nenhum — só diz se
 * a API está de pé e se o banco responde.
 */
export async function healthRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    "/",
    {
      schema: {
        tags: ["Health"],
        summary: "Healthcheck da API e do banco",
        description:
          "Público, sem sessão e sem header de loja. Faz um `SELECT 1` no banco: `200 { status: 'ok' }` se responde, `503 { status: 'error' }` se não. Usado pelo `HEALTHCHECK` do Docker e pelo smoke test do deploy. Não devolve nenhum detalhe do erro.",
        response: {
          200: z.object({ status: z.literal("ok") }),
          503: z.object({ status: z.literal("error") }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`

        return reply.status(200).send({ status: "ok" as const })
      } catch {
        // Sem a mensagem do erro: ela pode carregar host e usuário do banco.
        return reply.status(503).send({ status: "error" as const })
      }
    }
  )
}
