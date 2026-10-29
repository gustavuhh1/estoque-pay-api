import { prisma } from "@/lib/prisma"
import { PlanoPrismaRepository } from "@/modules/billing/repository/PlanoPrismaRepository"
import { PlanoService } from "@/modules/billing/service/PlanoService"
import type { INfceEmissor } from "../emissor/INfceEmissor"
import { NfceSimuladaEmissor } from "../emissor/NfceSimuladaEmissor"
import { NfcePrismaRepository } from "../repository/NfcePrismaRepository"
import { NfceService } from "./NfceService"

/**
 * Monta o `NfceService` de produção. Dois lugares precisam dele: as rotas de
 * `/nfce` e o PDV (`/pagamento`), que dispara a emissão quando a venda é paga.
 * Hoje o emissor é o simulado (D3); trocar por um real é mudar só este ponto.
 */
export function criarNfceService(emissor: INfceEmissor = new NfceSimuladaEmissor()) {
  return new NfceService(
    new NfcePrismaRepository(prisma),
    new PlanoService(new PlanoPrismaRepository(prisma)),
    emissor
  )
}
