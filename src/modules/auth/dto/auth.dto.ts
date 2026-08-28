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
