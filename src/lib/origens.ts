import type { FastifyCorsOptions } from "@fastify/cors"

/**
 * Origens que podem falar com a API pelo navegador (Etapa 5).
 *
 * Duas configurações dependem da mesma lista, então ela mora num lugar só:
 * - o CORS do Fastify;
 * - o `trustedOrigins` do better-auth, que recusa requisições de origem
 *   desconhecida (proteção de CSRF) mesmo quando o CORS deixa passar.
 *
 * Fontes, unidas: `TRUSTED_ORIGINS` (lista separada por vírgula) e `APP_URL`
 * (a URL pública do front). Cada valor é reduzido à origem (`https://host`),
 * sem caminho nem barra final, que é como o navegador manda o header `Origin`.
 */
export function origensConfiaveis(env: NodeJS.ProcessEnv = process.env): string[] {
  const brutas = [...(env.TRUSTED_ORIGINS ?? "").split(","), env.APP_URL ?? ""]

  const origens = brutas
    .map((valor) => valor.trim())
    .filter(Boolean)
    .map(paraOrigem)
    .filter((origem): origem is string => origem !== null)

  return [...new Set(origens)]
}

function paraOrigem(valor: string): string | null {
  try {
    const url = new URL(valor)

    // `new URL("localhost:3000")` NÃO falha: lê "localhost:" como esquema e a
    // origem sai como a string "null". Só http(s) é origem de navegador.
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null
  } catch {
    // Valor que não é URL (ex.: `localhost:3000` sem esquema) não vira origem:
    // melhor ficar de fora do que liberar algo que ninguém entende.
    return null
  }
}

/**
 * Em PRODUÇÃO o CORS só aceita as origens confiáveis, com `credentials` (o
 * cookie de sessão viaja). Fora dela continua aberto, porque o front de
 * desenvolvimento roda em portas variadas (Vite, etc.).
 *
 * Produção sem nenhuma origem configurada recusa tudo em vez de abrir: a
 * omissão da variável nunca pode virar `origin: true`.
 */
export function opcoesDeCors(env: NodeJS.ProcessEnv = process.env): FastifyCorsOptions {
  if (env.NODE_ENV !== "production") {
    return { origin: true }
  }

  return { origin: origensConfiaveis(env), credentials: true }
}
