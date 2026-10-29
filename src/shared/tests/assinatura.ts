import type { StatusAssinatura } from "../../../generated/prisma/client.js"
import { prisma } from "@/lib/prisma"

/**
 * Dá uma assinatura à loja de teste. Por padrão ACTIVE (Premium); passe
 * `PAST_DUE`/`CANCELED` para simular a loja rebaixada.
 *
 * Existe porque o plano é derivado de `Assinatura.status` (RN00) e o Free tem
 * tetos (RN01): teste que precisa de CRM completo ou de mais de 50 produtos
 * monta o cenário Premium por aqui, em vez de espalhar `prisma.assinatura`.
 */
export async function criarAssinatura(
  estabelecimentoId: string,
  status: StatusAssinatura = "ACTIVE"
) {
  return prisma.assinatura.create({
    data: { estabelecimento_id: estabelecimentoId, status },
  })
}
