import z from "zod"

export const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().optional(),
  image: z.string().optional(),
  rememberMe: z.boolean().optional(),
  callbackURL: z.string().optional(),
})
export type SignUpDTO = z.infer<typeof signUpSchema>

export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})
export type SignInDTO = z.infer<typeof signInSchema>

export const forgotPasswordSchema = z.object({
  email: z.email(),
})
export type ForgotPasswordDTO = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8),
})
export type ResetPasswordDTO = z.infer<typeof resetPasswordSchema>

/**
 * Schemas de resposta: além de documentar o contrato no /apidocs, o Fastify
 * usa cada um deles para serializar a resposta daquele status.
 */
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const signUpResponseSchema = z.object({
  message: z.string(),
  user: userResponseSchema,
})

export const signInResponseSchema = z.object({
  message: z.string(),
  user: userResponseSchema,
})

export const passwordResetResponseSchema = z.object({
  status: z.boolean(),
  message: z.string().optional(),
})
