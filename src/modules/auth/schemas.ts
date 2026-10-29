import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Informe o e-mail')
  .pipe(z.email({ message: 'E-mail inválido' }))

export const newPasswordSchema = z
  .string()
  .min(10, 'Use pelo menos 10 caracteres')
  .max(72, 'Use no máximo 72 caracteres')
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Combine letras e números')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
})

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Informe seu nome').max(120, 'Nome muito longo'),
    email: emailSchema,
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' })

export const forgotSchema = z.object({ email: emailSchema })

export const resetSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' })

export type LoginValues = z.infer<typeof loginSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
export type ForgotValues = z.infer<typeof forgotSchema>
export type ResetValues = z.infer<typeof resetSchema>
