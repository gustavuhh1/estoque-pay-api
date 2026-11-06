import type { PrismaClient } from "../../../generated/prisma/client.js"

/**
 * Foto de perfil (RF01.7). Guardada no próprio `User.image`, sem serviço de arquivos:
 * - a enviada no Meu perfil é um data URI pequeno (o front reduz para 256 px antes de enviar);
 * - a do Google é a URL que vem no ID token da conta vinculada.
 */

/** ~100 KB de imagem em base64 (4/3 do tamanho binário) mais o cabeçalho do data URI. */
export const FOTO_MAX_CARACTERES = 140_000

const DATA_URI_FOTO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function fotoEnviadaValida(foto: string): boolean {
  return foto.length <= FOTO_MAX_CARACTERES && DATA_URI_FOTO.test(foto)
}

/** Só HTTPS: a foto vira `src` de <img> em todas as telas. */
function urlHttps(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  try {
    return new URL(valor).protocol === "https:" ? valor : null
  } catch {
    return null
  }
}

/**
 * Lê o `picture` do ID token do Google. Não confere a assinatura: o token chega ao
 * better-auth pela troca de código com o próprio Google (servidor para servidor) e já
 * está gravado na conta, então aqui ele é só o lugar onde a URL da foto mora.
 */
export function fotoDoIdToken(idToken: string | null | undefined): string | null {
  const payload = idToken?.split(".")[1]
  if (!payload) return null
  try {
    const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { picture?: unknown }
    return urlHttps(dados.picture)
  } catch {
    return null
  }
}

type ContaOAuth = { providerId: string; userId: string; idToken?: string | null | undefined }

/**
 * Regra do RF01.7: quem entra pelo Google e ainda não tem foto passa a usar a do Google.
 * O `image: null` no filtro faz a checagem e a escrita num comando só, então uma foto
 * enviada no Meu perfil nunca é sobrescrita.
 */
export async function preencherFotoDoGoogle(prisma: PrismaClient, conta: ContaOAuth): Promise<boolean> {
  if (conta.providerId !== "google") return false
  const foto = fotoDoIdToken(conta.idToken)
  if (!foto) return false
  const { count } = await prisma.user.updateMany({ where: { id: conta.userId, image: null }, data: { image: foto } })
  return count > 0
}
