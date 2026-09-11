import { betterAuth } from "better-auth";
import "dotenv/config";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { resend } from "./resend";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url, token }, request) => {
      await resend.emails.send({
        // TODO: adicionar email de remetente válido
        from: "[EMAIL_ADDRESS]",
        to: user.email,
        subject: "Reset your password",
        html: `<h1>Reset your password</h1>
        <p>Click the link to reset your password: ${url}</p>
        <p>Seu token é: ${token}</p>
        <p>Se você não solicitou essa redefinição de senha, ignore este email.</p>
        <p>Este link expirará em 1 hora.</p>
        <p>Obrigado!</p>
        <p>Equipe Estoque Pay</p>`,
      });
    },
    onPasswordReset: async ({ user }, request) => {
      console.log(`Password for user ${user.email} has been reset.`);
    },
  },
  // TODO: Implementar a autenticação social com Google.
  socialProviders: {
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID || "",
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    //   prompt: "select_account",
    // },
  },
});
