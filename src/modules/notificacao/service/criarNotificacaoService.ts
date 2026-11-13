import { prisma } from "@/lib/prisma"
import { NotificacaoPrismaRepository } from "../repository/NotificacaoPrismaRepository"
import { NotificacaoService } from "./NotificacaoService"

/**
 * Monta o `NotificacaoService` de produção. Além das rotas de `/notificacao`,
 * os módulos que DISPARAM avisos (pagamento, venda, estoque, caixa) recebem
 * esta instância — mesmo padrão do `criarNfceService`.
 */
export function criarNotificacaoService() {
  return new NotificacaoService(new NotificacaoPrismaRepository(prisma))
}
