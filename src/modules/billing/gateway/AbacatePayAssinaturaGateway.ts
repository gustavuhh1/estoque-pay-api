import { AbacatePay } from "@abacatepay/sdk"
import type { ProductCycle } from "@abacatepay/types/v2"
import type { TipoPlano } from "../../../../generated/prisma/client.js"
import { BadRequestError } from "@/shared/errors"
import { PRECO_PREMIUM, TRIAL_DIAS } from "../planos"
import type {
  AssinaturaDoProvedor,
  CheckoutAssinaturaCriado,
  CriarCheckoutAssinaturaParams,
  IAssinaturaGateway,
  StatusAssinaturaProvedor,
} from "./IAssinaturaGateway"

/**
 * Integração com as assinaturas da AbacatePay (issues #65 a #67), via SDK
 * oficial `@abacatepay/sdk`.
 *
 * Formas conferidas na documentação e nos tipos do SDK 3.0.0 em 2026-10-29:
 * - `POST /subscriptions/create` NÃO cria a assinatura: cria um CHECKOUT
 *   (`bill_...`) com uma `url` hospedada pela AbacatePay. A assinatura
 *   (`subs_...`) só existe depois que o cliente paga, e o webhook avisa.
 * - O trial NÃO é parâmetro do checkout: vem do PRODUTO (`trialDays`). Com
 *   trial, o cliente informa o cartão, paga R$ 0,00 e a assinatura fica
 *   ACTIVE; a primeira cobrança integral é em `trialEndsAt`.
 * - O ciclo (mensal/anual) também vem do produto.
 * - Cartão: coletado e tokenizado no checkout hospedado. O backend nunca vê
 *   dados de cartão (RNF02) e não precisa do `abacatepay.js`.
 * - O SDK nunca lança: toda chamada resolve para `{ data, error, success }`.
 *
 * NÃO foi exercitado contra o sandbox neste ambiente (sem chave dev). Validar
 * na Etapa 5/7: o `externalId` de produto duplicado, o payload dos eventos
 * `subscription.*` e a data de fim do trial.
 *
 * https://docs.abacatepay.com/pages/subscriptions/reference
 * https://docs.abacatepay.com/pages/products/create
 */
type AbacatePayClient = ReturnType<typeof AbacatePay>

const PRODUTO_POR_PLANO: Record<
  TipoPlano,
  { externalId: string; nome: string; preco: number; ciclo: ProductCycle }
> = {
  MENSAL: {
    externalId: "estoquepay-premium-mensal",
    nome: "EstoquePay Premium (mensal)",
    preco: Math.round(PRECO_PREMIUM.MENSAL * 100),
    ciclo: "MONTHLY" as ProductCycle,
  },
  ANUAL: {
    externalId: "estoquepay-premium-anual",
    nome: "EstoquePay Premium (anual)",
    preco: Math.round(PRECO_PREMIUM.ANUAL * 100),
    ciclo: "ANNUALLY" as ProductCycle,
  },
}

/**
 * `externalId` do checkout: `<estabelecimento_id>:<plano>:<timestamp>`. O
 * timestamp deixa o dono refazer um checkout abandonado sem colidir com o
 * anterior; o resto permite achar a loja e o plano quando o webhook chega.
 */
const SEPARADOR = ":"

export function montarExternalId(estabelecimentoId: string, plano: TipoPlano): string {
  return [estabelecimentoId, plano, Date.now()].join(SEPARADOR)
}

export function lerExternalId(
  externalId: string | null | undefined
): { estabelecimento_id: string; tipo_plano: TipoPlano | null } | null {
  if (!externalId) return null

  const [estabelecimentoId, plano] = externalId.split(SEPARADOR)

  if (!estabelecimentoId) return null

  return {
    estabelecimento_id: estabelecimentoId,
    tipo_plano: plano === "MENSAL" || plano === "ANUAL" ? plano : null,
  }
}

export class AbacatePayAssinaturaGateway implements IAssinaturaGateway {
  private readonly client: AbacatePayClient | null
  /** Id do produto por plano. Cache de processo: o produto é criado uma vez. */
  private readonly produtos = new Map<TipoPlano, string>()

  /** `client` injetável só para o teste do adaptador; o resto usa a chave do ambiente. */
  constructor(config?: { apiKey?: string; client?: AbacatePayClient }) {
    const apiKey = config?.apiKey ?? process.env.ABACATEPAY_API_KEY ?? ""

    this.client = config?.client ?? (apiKey ? AbacatePay({ secret: apiKey }) : null)
  }

  async criarCheckoutAssinatura(
    params: CriarCheckoutAssinaturaParams
  ): Promise<CheckoutAssinaturaCriado> {
    const client = this.exigirClient()
    const produtoId = await this.garantirProduto(client, params.tipo_plano)

    // Se já existe cadastro com o mesmo CPF/CNPJ, a AbacatePay devolve o
    // existente em vez de duplicar.
    const cliente = await client.customers.create({
      email: params.cliente.email,
      ...(params.cliente.nome && { name: params.cliente.nome }),
      ...(params.cliente.documento && { taxId: params.cliente.documento }),
    })

    if (!cliente.success) {
      throw this.recusa("criar o cliente", cliente.error)
    }

    const checkout = await client.subscriptions.create({
      items: [{ id: produtoId, quantity: 1 }],
      // D2: só cartão. Pix não é aceito para assinatura.
      methods: ["CARD"] as never,
      customerId: cliente.data.id,
      externalId: montarExternalId(params.estabelecimento_id, params.tipo_plano),
      returnUrl: params.url_retorno,
      completionUrl: params.url_conclusao,
    })

    if (!checkout.success) {
      throw this.recusa("criar o checkout da assinatura", checkout.error)
    }

    return {
      checkout_id: checkout.data.id,
      url: checkout.data.url,
      customer_id: cliente.data.id,
    }
  }

  async consultarAssinatura(id: string): Promise<AssinaturaDoProvedor | null> {
    const client = this.exigirClient()

    if (id.startsWith("bill_")) {
      const checkout = await client.subscriptions.checkouts.get(id)

      if (!checkout.success) return null

      const assinatura = await client.subscriptions.get({
        externalId: checkout.data.externalId ?? "",
      })

      return assinatura.success
        ? this.mapear(assinatura.data, checkout.data.externalId)
        : null
    }

    const assinatura = await client.subscriptions.get({ id })

    if (!assinatura.success) return null

    // O objeto da assinatura não traz o `externalId`; ele está no checkout que
    // a originou.
    const checkoutId = assinatura.data.checkoutId
    const checkout = checkoutId
      ? await client.subscriptions.checkouts.get(checkoutId)
      : null

    return this.mapear(
      assinatura.data,
      checkout?.success ? checkout.data.externalId : null
    )
  }

  async cancelarAssinatura(subscriptionId: string): Promise<void> {
    const cancelada = await this.exigirClient().subscriptions.cancel(subscriptionId)

    if (!cancelada.success) {
      throw this.recusa("cancelar a assinatura", cancelada.error)
    }
  }

  /**
   * Cria o produto do plano na primeira vez e reaproveita depois. Busca por
   * `externalId` antes de criar; se dois processos criarem ao mesmo tempo, o
   * que perder a corrida relê o produto do outro.
   */
  private async garantirProduto(client: AbacatePayClient, plano: TipoPlano): Promise<string> {
    const emCache = this.produtos.get(plano)

    if (emCache) return emCache

    const definicao = PRODUTO_POR_PLANO[plano]
    const existente = await client.products.get({ externalId: definicao.externalId })

    if (existente.success) {
      this.produtos.set(plano, existente.data.id)
      return existente.data.id
    }

    const criado = await client.products.create({
      externalId: definicao.externalId,
      name: definicao.nome,
      price: definicao.preco,
      currency: "BRL",
      cycle: definicao.ciclo,
      // D2: 7 dias gratuitos, com cartão registrado antes de ativar (RN04).
      trialDays: TRIAL_DIAS,
    })

    if (criado.success) {
      this.produtos.set(plano, criado.data.id)
      return criado.data.id
    }

    const relido = await client.products.get({ externalId: definicao.externalId })

    if (relido.success) {
      this.produtos.set(plano, relido.data.id)
      return relido.data.id
    }

    throw this.recusa("criar o produto do plano", criado.error)
  }

  private mapear(
    assinatura: {
      id: string
      customerId: string
      status: string
      trialEndsAt?: string | null
    },
    externalId: string | null | undefined
  ): AssinaturaDoProvedor {
    const dono = lerExternalId(externalId)

    return {
      subscription_id: assinatura.id,
      customer_id: assinatura.customerId,
      status: assinatura.status as StatusAssinaturaProvedor,
      trial_expira_em: assinatura.trialEndsAt ? new Date(assinatura.trialEndsAt) : null,
      estabelecimento_id: dono?.estabelecimento_id ?? null,
      tipo_plano: dono?.tipo_plano ?? null,
    }
  }

  private exigirClient(): AbacatePayClient {
    if (!this.client) {
      throw new Error("ABACATEPAY_API_KEY não configurada — impossível usar a assinatura.")
    }

    return this.client
  }

  private recusa(acao: string, erro: string | null): BadRequestError {
    return new BadRequestError(
      `A AbacatePay recusou ${acao}.`,
      "GATEWAY_ASSINATURA_ERRO",
      { resposta: (erro ?? "").slice(0, 500) }
    )
  }
}
