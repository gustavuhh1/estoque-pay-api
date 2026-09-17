import { betterAuth } from "better-auth";
import "dotenv/config";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { sendEmail } from "./brevo";
import { oneTap } from "better-auth/plugins";
import { vincularConvitesPendentes } from "@/modules/equipe/service/vincularConvitesPendentes";

export const auth = betterAuth({
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  databaseHooks: {
    user: {
      create: {
        // Roda tanto no signUpEmail quanto no callback do Google — é o único
        // ponto em comum aos dois fluxos de cadastro (ver #41, RN01).
        after: async (user) => {
          await vincularConvitesPendentes(prisma, { id: user.id, email: user.email });
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url, token }, request) => {
      await sendEmail({
        to: user.email,
        subject: "Redefinição de senha",
        html: `<h1>Redefinição de senha</h1>
        <p>Clique no link para redefinir sua senha: ${url}</p>
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      prompt: "select_account",
    },
  },
  plugins: [
    oneTap({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
    }),
  ],
});
