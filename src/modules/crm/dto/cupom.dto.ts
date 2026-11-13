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

const tipoDescontoSchema = z.enum(["VALOR", "PERCENTUAL"])
export type TipoDesconto = z.infer<typeof tipoDescontoSchema>

/**
 * RF02.3: emissão de cupom. Com `cliente_id` é INDIVIDUAL (só esse cliente,
 * uma vez); sem ele é GLOBAL (qualquer cliente identificado, uma vez por CPF).
 */
export const createCupomSchema = z
  .object({
    /** Omitido = cupom global da loja. */
    cliente_id: z.uuid().optional(),
    /** Omitido = o sistema gera um código aleatório. */
    codigo: codigoCupomSchema.optional(),
    /** Omitido = VALOR (R$), o comportamento original. */
    tipo_desconto: tipoDescontoSchema.optional(),
    /** R$ em VALOR; porcentagem (até 100) em PERCENTUAL. */
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
  .refine((data) => data.tipo_desconto !== "PERCENTUAL" || data.valor_desconto <= 100, {
    message: "O desconto em porcentagem vai até 100%.",
    path: ["valor_desconto"],
  })
export type CreateCupomDTO = z.infer<typeof createCupomSchema>
export type CreateCupomInput = z.input<typeof createCupomSchema>

export const listCuponsQuerySchema = z.object({
  cliente_id: z.uuid().optional(),
})
export type ListCuponsQuery = z.infer<typeof listCuponsQuerySchema>

export const cupomIdParamsSchema = z.object({ id: z.uuid() })
export type CupomIdParams = z.infer<typeof cupomIdParamsSchema>

const statusCupomSchema = z.enum(["DISPONIVEL", "RESGATADO", "EXPIRADO", "DESATIVADO"])
export type StatusCupom = z.infer<typeof statusCupomSchema>

export const cupomResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  cliente_id: z.string().nullish(),
  /** Nome do cliente do cupom individual (para a tela de gestão). */
  cliente_nome: z.string().nullish(),
  codigo: z.string(),
  tipo_desconto: tipoDescontoSchema,
  valor_desconto: z.number(),
  expira_em: z.date().nullish(),
  resgatado_em: z.date().nullish(),
  venda_id: z.string().nullish(),
  desativado_em: z.date().nullish(),
  /** Quantas vendas usaram o cupom. */
  usos: z.number(),
  /** Soma do que o cupom já abateu, em R$. */
  desconto_total: z.number(),
  /** Derivado, não é coluna: desativado > resgatado > expirado > disponível. */
  status: statusCupomSchema,
  criado_em: z.date(),
})
export const listCuponsResponseSchema = z.array(cupomResponseSchema)

export const cupomUsoResponseSchema = z.object({
  id: z.uuid(),
  venda_id: z.string(),
  cliente_id: z.string(),
  cliente_nome: z.string().nullish(),
  /** Mascarado: "***.456.789-**". */
  cpf: z.string(),
  desconto: z.number(),
  usado_em: z.date(),
})
export const listCupomUsosResponseSchema = z.array(cupomUsoResponseSchema)

export function statusDoCupom(cupom: Cupom, agora = new Date()): StatusCupom {
  if (cupom.desativado_em) return "DESATIVADO"
  if (cupom.resgatado_em) return "RESGATADO"
  if (cupom.expira_em && cupom.expira_em <= agora) return "EXPIRADO"
  return "DISPONIVEL"
}

/** O que a listagem traz junto do cupom: nome do cliente e os usos (só o desconto de cada um). */
export type CupomComResumo = Cupom & {
  cliente?: { nome: string } | null
  usos?: { desconto: unknown }[]
}

/**
 * `valor_desconto` é `Decimal` no Prisma e o response schema espera `number`
 * — mesma conversão fora do schema do `toProdutoResponse` (o serializer roda em
 * modo "encode" e não aceita `.transform()` na resposta).
 */
export function toCupomResponse(cupom: CupomComResumo) {
  const { cliente, usos, ...resto } = cupom
  return {
    ...resto,
    valor_desconto: Number(cupom.valor_desconto),
    cliente_nome: cliente?.nome ?? null,
    usos: usos?.length ?? (cupom.resgatado_em ? 1 : 0),
    desconto_total: (usos ?? []).reduce((soma, uso) => soma + Number(uso.desconto), 0),
    status: statusDoCupom(cupom),
  }
}

export const mascararCpf = (cpf: string) => (cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : "***")
