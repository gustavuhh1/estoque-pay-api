import z from "zod"
import { isValidCnpj, sanitizeCnpj } from "@/shared/utils"

export const createEstabelecimentoSchema = z.object({
  nome: z.string().trim().min(2, "O nome do estabelecimento é obrigatório."),
  // Aceita com ou sem máscara, mas normaliza antes de validar/gravar: sem isso
  // "11.222.333/0001-81" e "11222333000181" viram duas lojas e o @unique do
  // CNPJ não protege nada.
  cnpj: z
    .string()
    .transform(sanitizeCnpj)
    .refine(isValidCnpj, "CNPJ inválido.")
    .meta({ example: "11.222.333/0001-81" }),
  ie: z.string().trim().optional(),
  emite_nfce: z.boolean().optional().default(false),
})

/** Saída do parse: o que o service recebe (cnpj já normalizado). */
export type CreateEstabelecimentoDTO = z.infer<typeof createEstabelecimentoSchema>
/** Entrada do parse: o que o cliente envia (cnpj ainda mascarado). */
export type CreateEstabelecimentoInput = z.input<typeof createEstabelecimentoSchema>

/**
 * Schemas de resposta: além de documentar o contrato no /apidocs, o Fastify usa
 * cada um deles para serializar. É isso que garante que campos sensíveis do
 * estabelecimento (certificado_a1_senha) nunca vazem na resposta.
 */
export const estabelecimentoResponseSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  cnpj: z.string(),
  ie: z.string().nullish(),
  emite_nfce: z.boolean(),
  criado_em: z.date(),
})

export const membroResponseSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  estabelecimentoId: z.uuid(),
  role: z.enum(["ADMIN", "OWNER", "MANAGER", "CASHIER"]),
})

export const createEstabelecimentoResponseSchema = z.object({
  message: z.string(),
  estabelecimento: estabelecimentoResponseSchema,
  membro: membroResponseSchema,
})
