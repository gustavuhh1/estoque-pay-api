import z from "zod"
import { isValidCpf, sanitizeCpf } from "@/shared/utils"

/**
 * Aceita com ou sem máscara, mas normaliza antes de validar/gravar: sem isso
 * "529.982.247-25" e "52998224725" viram dois clientes e o @@unique
 * (estabelecimento_id, cpf) não protege nada. Mesmo padrão do CNPJ.
 */
const cpfSchema = z
  .string()
  .transform(sanitizeCpf)
  .refine(isValidCpf, "CPF inválido.")
  .meta({ example: "529.982.247-25" })

/**
 * Data no formato `YYYY-MM-DD`, sem hora: aniversário não tem fuso. O
 * `.transform` pode ficar aqui porque é schema de ENTRADA (o problema do modo
 * "encode" do serializer só existe nos schemas de resposta).
 */
const dataNascimentoSchema = z.iso
  .date("Use o formato AAAA-MM-DD.")
  .transform((valor) => new Date(valor))
  .refine((data) => data <= new Date(), "A data de nascimento não pode estar no futuro.")
  .meta({ example: "1990-05-17" })

const telefoneSchema = z.string().trim().min(8, "Telefone inválido.").max(20)
const observacaoSchema = z.string().trim().min(1).max(1000)

/** RF01.1: CPF e nome obrigatórios; o resto é opcional. */
export const createClienteSchema = z.object({
  nome: z.string().trim().min(2, "O nome do cliente é obrigatório."),
  cpf: cpfSchema,
  telefone: telefoneSchema.optional(),
  data_nascimento: dataNascimentoSchema.optional(),
  observacao: observacaoSchema.optional(),
  // `pontos_fidelidade` NÃO é parâmetro de criação: nasce 0 e só pode mudar
  // por regra de fidelidade, nunca pela mão de quem cadastra.
})
/** Saída do parse: o que o service recebe (cpf já normalizado, data já Date). */
export type CreateClienteDTO = z.infer<typeof createClienteSchema>
/** Entrada do parse: o que o cliente HTTP envia. */
export type CreateClienteInput = z.input<typeof createClienteSchema>

/**
 * RF01.4: atualização parcial. Os opcionais aceitam `null` para limpar o
 * campo; nome e CPF não, porque são obrigatórios no cadastro.
 */
export const updateClienteSchema = z
  .object({
    nome: z.string().trim().min(2, "O nome do cliente é obrigatório.").optional(),
    cpf: cpfSchema.optional(),
    telefone: telefoneSchema.nullable().optional(),
    data_nascimento: dataNascimentoSchema.nullable().optional(),
    observacao: observacaoSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })
export type UpdateClienteDTO = z.infer<typeof updateClienteSchema>

export const clienteParamsSchema = z.object({
  id: z.uuid(),
})
export type ClienteParams = z.infer<typeof clienteParamsSchema>

/**
 * RF01.2. `busca` casa PARCIAL no nome (sem diferenciar maiúsculas) e pelo
 * início do CPF — é o que o caixa digita no balcão para achar o cliente.
 *
 * Mesma pegadinha da listagem de movimentações: parâmetro vazio (`?page=`) é
 * erro de validação, o cliente deve omitir o que não usa.
 */
export const listClientesQuerySchema = z.object({
  busca: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListClientesQuery = z.infer<typeof listClientesQuerySchema>

export const clienteResponseSchema = z.object({
  id: z.uuid(),
  estabelecimento_id: z.uuid(),
  nome: z.string(),
  cpf: z.string(),
  telefone: z.string().nullish(),
  data_nascimento: z.date().nullish(),
  observacao: z.string().nullish(),
  pontos_fidelidade: z.number().int(),
  criado_em: z.date(),
  atualizado_em: z.date(),
})

export const listClientesResponseSchema = z.object({
  data: z.array(clienteResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})
