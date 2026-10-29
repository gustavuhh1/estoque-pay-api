import { randomUUID } from "node:crypto"
import type { TipoPlano } from "../../../../generated/prisma/client.js"
import { NotFoundError } from "@/shared/errors"
import type {
  AssinaturaDoProvedor,
  CheckoutAssinaturaCriado,
  CriarCheckoutAssinaturaParams,
  IAssinaturaGateway,
  StatusAssinaturaProvedor,
} from "./IAssinaturaGateway"

/**
 * Dublê da AbacatePay para os testes de assinatura: nenhuma chamada de rede e
 * nenhuma chave. O teste controla o que o "provedor" responde.
 */
export class InMemoryAssinaturaGateway implements IAssinaturaGateway {
  /** Checkouts criados, para os testes inspecionarem o que foi pedido. */
  public readonly checkouts: Array<CriarCheckoutAssinaturaParams & { checkout_id: string }> = []
  public readonly canceladas: string[] = []
  /** Assinaturas que o provedor "conhece", por id (`subs_...` ou `bill_...`). */
  private readonly assinaturas = new Map<string, AssinaturaDoProvedor>()

  async criarCheckoutAssinatura(
    params: CriarCheckoutAssinaturaParams
  ): Promise<CheckoutAssinaturaCriado> {
    const checkout_id = `bill_${randomUUID()}`
    this.checkouts.push({ ...params, checkout_id })

    return {
      checkout_id,
      url: `https://app.abacatepay.com/pay/${checkout_id}`,
      customer_id: `cust_${randomUUID()}`,
    }
  }

  async consultarAssinatura(id: string): Promise<AssinaturaDoProvedor | null> {
    return this.assinaturas.get(id) ?? null
  }

  async cancelarAssinatura(subscriptionId: string): Promise<void> {
    if (![...this.assinaturas.values()].some((a) => a.subscription_id === subscriptionId)) {
      throw new NotFoundError("Assinatura não encontrada.", "ASSINATURA_NAO_ENCONTRADA")
    }

    this.canceladas.push(subscriptionId)
    this.definir(subscriptionId, { status: "CANCELLED" })
  }

  /**
   * Helper de teste: registra (ou atualiza) uma assinatura no "provedor". O
   * `subscription_id` e o `checkout_id` passam a levar à mesma assinatura.
   */
  registrar(
    dados: {
      subscription_id: string
      estabelecimento_id: string | null
      status?: StatusAssinaturaProvedor
      trial_expira_em?: Date | null
      tipo_plano?: TipoPlano | null
      customer_id?: string
      checkout_id?: string
    }
  ): AssinaturaDoProvedor {
    const assinatura: AssinaturaDoProvedor = {
      subscription_id: dados.subscription_id,
      customer_id: dados.customer_id ?? "cust_teste",
      status: dados.status ?? "ACTIVE",
      trial_expira_em: dados.trial_expira_em ?? null,
      estabelecimento_id: dados.estabelecimento_id,
      tipo_plano: dados.tipo_plano ?? "MENSAL",
    }

    this.assinaturas.set(dados.subscription_id, assinatura)

    if (dados.checkout_id) {
      this.assinaturas.set(dados.checkout_id, assinatura)
    }

    return assinatura
  }

  /** Helper de teste: muda o estado de uma assinatura já registrada. */
  definir(subscriptionId: string, mudancas: Partial<AssinaturaDoProvedor>) {
    for (const [chave, assinatura] of this.assinaturas) {
      if (assinatura.subscription_id === subscriptionId) {
        this.assinaturas.set(chave, { ...assinatura, ...mudancas })
      }
    }
  }
}
