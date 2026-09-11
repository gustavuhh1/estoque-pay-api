import z from "zod"

/**
 * Envelope único de erro da API. Precisa refletir exatamente o que o
 * errorHandler envia — é ele que serializa as respostas de erro das rotas
 * que declaram `response`.
 */
export const errorResponseSchema = z.object({
  code: z.string().meta({ example: "EMAIL_ALREADY_IN_USE" }),
  message: z.string().meta({ example: "Este e-mail já está cadastrado." }),
  details: z.unknown().optional(),
  requestId: z.string(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>
