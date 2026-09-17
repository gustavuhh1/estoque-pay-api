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
  // emite_nfce NÃO é parâmetro de criação de propósito: nasce sempre false
  // (default do schema). Ligar o switch passa por um pre-check de conformidade
  // (RN01/RN01.1 — Certificado A1, CNPJ/IE, produtos com NCM/CFOP e plano
  // Premium ativo) que não existe no momento em que a loja é criada — ver
  // issue #59. Aceitar o campo aqui seria abrir uma porta para pular esse
  // pre-check inteiro.
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

const roleSchema = z.enum(["ADMIN", "OWNER", "MANAGER", "CASHIER"])

export const membroResponseSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  estabelecimentoId: z.uuid(),
  role: roleSchema,
})

export const createEstabelecimentoResponseSchema = z.object({
  message: z.string(),
  estabelecimento: estabelecimentoResponseSchema,
  membro: membroResponseSchema,
})

/** RF03.1: cada loja do usuário vem com o cargo dele nela. */
export const estabelecimentoListItemSchema = estabelecimentoResponseSchema.extend({
  role: roleSchema,
})
export const listEstabelecimentosResponseSchema = z.array(estabelecimentoListItemSchema)

/**
 * RF03.2 / RF04.1: dados completos da loja ativa. Inclui `certificado_a1`
 * (é só o caminho/URL do arquivo), mas nunca `certificado_a1_senha` — o
 * schema de resposta é quem garante isso, não uma checagem manual.
 */
export const estabelecimentoAtivoResponseSchema = estabelecimentoResponseSchema.extend({
  certificado_a1: z.string().nullish(),
  role: roleSchema,
})

/**
 * RF04.2: atualização parcial dos dados cadastrais da loja ativa.
 * `emite_nfce` fica de fora pelo mesmo motivo do create acima — issue #59.
 */
export const updateEstabelecimentoSchema = z
  .object({
    nome: z.string().trim().min(2, "O nome do estabelecimento é obrigatório.").optional(),
    cnpj: z
      .string()
      .transform(sanitizeCnpj)
      .refine(isValidCnpj, "CNPJ inválido.")
      .optional(),
    ie: z.string().trim().nullable().optional(),
    certificado_a1: z.string().nullable().optional(),
    certificado_a1_senha: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })

export type UpdateEstabelecimentoDTO = z.infer<typeof updateEstabelecimentoSchema>
export type UpdateEstabelecimentoInput = z.input<typeof updateEstabelecimentoSchema>
