import { betterAuth } from "better-auth";
import "dotenv/config";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { sendEmail } from "./brevo";
import { oneTap } from "better-auth/plugins";
import { vincularConvitesPendentes } from "@/modules/equipe/service/vincularConvitesPendentes";
import { origensConfiaveis } from "./origens";
import { fotoEnviadaValida, preencherFotoDoGoogle } from "@/modules/perfil/foto";

/** Completar a foto nunca pode derrubar o login: falha aqui só deixa o usuário sem foto. */
async function completarFoto(conta: { providerId: string; userId: string; idToken?: string | null | undefined }) {
  try {
    await preencherFotoDoGoogle(prisma, conta);
  } catch (erro) {
    console.error("Não foi possível completar a foto pelo Google:", erro);
  }
}

export const auth = betterAuth({
  // `baseURL` (com URL maiúsculo) é o nome real da opção; o `baseUrl` que estava
  // aqui era ignorado e valia só o BETTER_AUTH_URL do ambiente. Hospedado, esta é a
  // URL PÚBLICA que o navegador enxerga: se o front faz proxy de /api, é a do front.
  baseURL: process.env.BETTER_AUTH_URL || process.env.BASE_URL || "http://localhost:3333",
  // Requisição de origem fora desta lista é recusada (CSRF), além do CORS.
  trustedOrigins: origensConfiaveis(),
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
      update: {
        // A rota nativa /api/auth/update-user aceita `image` livre: só deixa passar o
        // mesmo formato do Meu perfil (data URI pequeno), HTTPS ou remoção.
        before: async (dados) => {
          const foto = (dados as { image?: unknown }).image;
          if (foto === undefined || foto === null) return;
          const https = typeof foto === "string" && foto.startsWith("https://");
          if (!https && !(typeof foto === "string" && fotoEnviadaValida(foto))) return false;
        },
      },
    },
    // RF01.7: o better-auth grava a conta do Google ao vincular e atualiza o token a cada
    // login. Nos dois momentos, quem ainda não tem foto passa a usar a do Google.
    account: {
      create: { after: async (conta) => completarFoto(conta) },
      update: { after: async (conta) => completarFoto(conta) },
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
