import z from "zod"
import { isValidCpf, sanitizeCpf } from "@/shared/utils"
import { vendaResponseSchema } from "@/modules/venda/dto/venda.dto"

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

/** RF02.1: histórico de compras do cliente, da mais recente para a mais antiga. */
export const listComprasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListComprasQuery = z.infer<typeof listComprasQuerySchema>

/**
 * Reusa o `vendaResponseSchema` do módulo de vendas: uma compra do cliente É
 * uma venda, com o mesmo contrato do cancelamento. Vendas canceladas aparecem
 * no histórico (com `status_pagamento: CANCELADO`), mas não contam nas
 * estatísticas.
 */
export const listComprasResponseSchema = z.object({
  data: z.array(vendaResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

/** RF02.2: `top` é quantos produtos favoritos devolver. */
export const estatisticasQuerySchema = z.object({
  top: z.coerce.number().int().min(1).max(20).default(5),
})
export type EstatisticasQuery = z.infer<typeof estatisticasQuerySchema>

export const produtoFavoritoSchema = z.object({
  produto_id: z.uuid(),
  produto_nome: z.string(),
  /** Em quantas linhas de venda o produto apareceu. É o critério de ordenação. */
  vezes_comprado: z.number().int(),
  /** Soma das quantidades (unidades ou kg, conforme o tipo de medida). */
  quantidade_total: z.number(),
})
export type ProdutoFavorito = z.infer<typeof produtoFavoritoSchema>

export const estatisticasResponseSchema = z.object({
  cliente_id: z.uuid(),
  total_compras: z.number().int(),
  valor_total_gasto: z.number(),
  ticket_medio: z.number(),
  primeira_compra_em: z.date().nullable(),
  ultima_compra_em: z.date().nullable(),
  produtos_favoritos: z.array(produtoFavoritoSchema),
})
export type EstatisticasCliente = z.infer<typeof estatisticasResponseSchema>
