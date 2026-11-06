import { z } from "zod"
import { FOTO_MAX_CARACTERES, fotoEnviadaValida } from "../foto"

/** RF01.7: `foto` é um data URI (PNG, JPEG ou WebP) de até ~100 KB, ou `null` para remover. */
export const updatePerfilSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "O nome precisa de pelo menos 2 caracteres.")
      .max(80, "Use no máximo 80 caracteres.")
      .optional(),
    foto: z
      .string()
      .max(FOTO_MAX_CARACTERES, "A foto passa do tamanho máximo (cerca de 100 KB).")
      .refine(fotoEnviadaValida, "Envie a foto como imagem PNG, JPEG ou WebP.")
      .nullable()
      .optional(),
  })
  .refine((dados) => dados.nome !== undefined || dados.foto !== undefined, {
    message: "Informe o nome ou a foto.",
  })
export type UpdatePerfilDTO = z.infer<typeof updatePerfilSchema>

export const perfilResponseSchema = z.object({
  id: z.string(),
  nome: z.string().nullable(),
  email: z.email(),
  email_verificado: z.boolean(),
  /** URL do Google ou data URI enviado no Meu perfil. */
  foto: z.string().nullable(),
  /** Como a pessoa pode entrar: e-mail e senha e/ou Google. */
  metodos_login: z.array(z.enum(["EMAIL", "GOOGLE"])),
  /** Há uma conta Google com foto: o "Usar foto do Google" funciona. */
  foto_google_disponivel: z.boolean(),
  criado_em: z.date(),
  lojas: z.array(
    z.object({ id: z.uuid(), nome: z.string(), cnpj: z.string(), cargo: z.enum(["ADMIN", "OWNER", "MANAGER", "CASHIER"]) })
  ),
})
