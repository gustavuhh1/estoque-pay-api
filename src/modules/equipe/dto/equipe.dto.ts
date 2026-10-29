import z from "zod"
import type { ConviteFuncionario } from "../../../../generated/prisma/client.js"
import type { FuncionarioComUsuario } from "../repository/IEquipeRepository"

/**
 * ADMIN é papel de plataforma — não é atribuível por Owner/Gestor de loja
 * através deste módulo, só os três cargos operacionais de uma loja.
 */
const cargoAtribuivelSchema = z.enum(["OWNER", "MANAGER", "CASHIER"])

export const createFuncionarioSchema = z.object({
  email: z.email(),
  role: cargoAtribuivelSchema,
})
export type CreateFuncionarioDTO = z.infer<typeof createFuncionarioSchema>

export const updateFuncionarioSchema = z.object({
  role: cargoAtribuivelSchema,
})
export type UpdateFuncionarioDTO = z.infer<typeof updateFuncionarioSchema>

export const funcionarioParamsSchema = z.object({
  id: z.uuid(),
})
export type FuncionarioParams = z.infer<typeof funcionarioParamsSchema>

/** Também serve de whitelist de serialização (ver mesmo comentário em produto.dto.ts). */
export const funcionarioResponseSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  nome: z.string().nullish(),
  email: z.email(),
  role: z.enum(["ADMIN", "OWNER", "MANAGER", "CASHIER"]),
  criadoEm: z.date().nullish(),
})

export const conviteResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: cargoAtribuivelSchema,
  criadoEm: z.date(),
})

export const listEquipeResponseSchema = z.object({
  membros: z.array(funcionarioResponseSchema),
  convitesPendentes: z.array(conviteResponseSchema),
})

/**
 * Resposta do cadastro: dois formatos possíveis, um por status HTTP —
 * 201 quando o e-mail já tinha conta (vínculo direto e silencioso, RN01) e
 * 202 quando não tinha (convite pendente, e-mail de notificação disparado).
 */
export const funcionarioVinculadoResponseSchema = funcionarioResponseSchema
export const conviteEnviadoResponseSchema = conviteResponseSchema

export function toFuncionarioResponse(membro: FuncionarioComUsuario) {
  return {
    id: membro.id,
    userId: membro.userId,
    nome: membro.user.name,
    email: membro.user.email,
    role: membro.role,
    criadoEm: membro.createdAt,
  }
}

export function toConviteResponse(convite: ConviteFuncionario) {
  return {
    id: convite.id,
    email: convite.email,
    role: convite.role as "OWNER" | "MANAGER" | "CASHIER",
    criadoEm: convite.createdAt,
  }
}
