import z from "zod"
import type { Cupom } from "../../../../generated/prisma/client.js"

/**
 * Código digitado no balcão: só letras, números e hífen, gravado em
 * maiúsculas. Normalizar aqui (e no `cupom_codigo` do pagamento, que reusa este
 * schema) é o que faz "fid-10" e "FID-10" serem o mesmo cupom — senão o unique
 * (estabelecimento_id, codigo) deixaria passar os dois.
 */
export const codigoCupomSchema = z
  .string()
  .trim()
  .min(4, "O código do cupom precisa de ao menos 4 caracteres.")
  .max(30)
  .regex(/^[A-Za-z0-9-]+$/, "Use só letras, números e hífen no código do cupom.")
  .transform((codigo) => codigo.toUpperCase())
  .meta({ example: "FIDELIDADE-10" })

/** RF02.3: emissão de cupom de fidelidade. */
export const createCupomSchema = z.object({
  /** Omitido = cupom genérico da loja, que qualquer venda pode usar. */
  cliente_id: z.uuid().optional(),
  /** Omitido = o sistema gera um código aleatório. */
  codigo: codigoCupomSchema.optional(),
  valor_desconto: z
    .number()
    .positive("O valor do desconto deve ser maior que zero.")
    .multipleOf(0.01, "O desconto aceita no máximo 2 casas decimais."),
  /** Omitido = não expira. */
  expira_em: z.iso
    .datetime({ offset: true, message: "Use uma data/hora ISO 8601." })
    .transform((valor) => new Date(valor))
    .refine((data) => data > new Date(), "A validade precisa estar no futuro.")
    .optional()
    .meta({ example: "2026-12-31T23:59:59-03:00" }),
})
export type CreateCupomDTO = z.infer<typeof createCupomSchema>
export type CreateCupomInput = z.input<typeof createCupomSchema>

export const listCuponsQuerySchema = z.object({
  cliente_id: z.uuid().optional(),
})
export type ListCuponsQuery = z.infer<typeof listCuponsQuerySchema>

const statusCupomSchema = z.enum(["DISPONIVEL", "RESGATADO", "EXPIRADO"])
export type StatusCupom = z.infer<typeof statusCupomSchema>

export const cupomResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  cliente_id: z.string().nullish(),
  codigo: z.string(),
  valor_desconto: z.number(),
  expira_em: z.date().nullish(),
  resgatado_em: z.date().nullish(),
  venda_id: z.string().nullish(),
  /** Derivado, não é coluna: resgate vence validade (um cupom usado não "expira"). */
  status: statusCupomSchema,
  criado_em: z.date(),
})
export const listCuponsResponseSchema = z.array(cupomResponseSchema)

export function statusDoCupom(cupom: Cupom, agora = new Date()): StatusCupom {
  if (cupom.resgatado_em) return "RESGATADO"
  if (cupom.expira_em && cupom.expira_em <= agora) return "EXPIRADO"
  return "DISPONIVEL"
}

/**
 * `valor_desconto` é `Decimal` no Prisma e o response schema espera `number`
 * — mesma conversão fora do schema do `toProdutoResponse` (o serializer roda em
 * modo "encode" e não aceita `.transform()` na resposta).
 */
export function toCupomResponse(cupom: Cupom) {
  return {
    ...cupom,
    valor_desconto: Number(cupom.valor_desconto),
    status: statusDoCupom(cupom),
  }
}
