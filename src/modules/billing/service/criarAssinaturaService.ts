import { prisma } from "@/lib/prisma"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import { AbacatePayAssinaturaGateway } from "../gateway/AbacatePayAssinaturaGateway"
import type { IAssinaturaGateway } from "../gateway/IAssinaturaGateway"
import { AssinaturaPrismaRepository } from "../repository/AssinaturaPrismaRepository"
import { PlanoPrismaRepository } from "../repository/PlanoPrismaRepository"
import { AssinaturaService } from "./AssinaturaService"

/**
 * Monta o `AssinaturaService` de produção. Existe porque dois lugares precisam
 * dele: as rotas de billing e o webhook (que mora em `/pagamento`, para uma
 * única URL servir a Pix e a assinatura). Os testes passam o gateway dublê.
 */
export function criarAssinaturaService(
  gateway: IAssinaturaGateway = new AbacatePayAssinaturaGateway()
) {
  return new AssinaturaService(
    new PlanoPrismaRepository(prisma),
    new AssinaturaPrismaRepository(prisma),
    new EstabelecimentoPrismaRepository(prisma),
    gateway
  )
}
