import crypto from "node:crypto"
import { BadRequestError } from "@/shared/errors"
import type {
  CobrancaPixCriada,
  CriarCobrancaPixParams,
  IPagamentoGateway,
  StatusCobranca,
  StatusCobrancaPix,
} from "./IPagamentoGateway"

/**
 * Integração com a AbacatePay (issue #52).
 *
 * Formas conferidas na documentação oficial em 2026-09-20:
 * - base: https://api.abacatepay.com/v2 — o MESMO host serve dev e produção,
 *   quem decide o ambiente é a chave de API (chave de dev simula transação).
 *   Não existe URL de sandbox separada.
 * - auth: `Authorization: Bearer <chave>`
 * - criar cobrança Pix: POST /transparents/create
 * - consultar status:   GET  /transparents/check?id=<payment_id>
 * - simular pagamento:  POST /transparents/simulate-payment?id=<payment_id>
 * - webhook: header `X-Webhook-Signature`, HMAC-SHA256 do corpo cru, em base64
 *
 * Atenção ao procurar na internet: `/pixQrCode/*` é a API v1 ANTIGA. O fluxo
 * atual de QR Code Pix é `/transparents/*`, e é o único documentado na v2.
 *
 * https://docs.abacatepay.com/pages/authentication
 * https://docs.abacatepay.com/pages/transparents/create
 * https://docs.abacatepay.com/pages/transparents/check
 * https://docs.abacatepay.com/pages/transparents/simulate-payment
 * https://docs.abacatepay.com/pages/webhooks
 */
const BASE_URL_PADRAO = "https://api.abacatepay.com/v2"

/** Recorte do envelope de resposta do provedor que nos interessa. */
interface RespostaTransparent {
  success?: boolean
  error?: string | null
  data?: {
    id?: string
    brCode?: string
    brCodeBase64?: string
    expiresAt?: string
    platformFee?: number
    status?: string
  } | null
}

export class AbacatePayGateway implements IPagamentoGateway {
  private readonly apiKey: string
  private readonly webhookSecret: string
  private readonly baseUrl: string

  constructor(config?: { apiKey?: string; webhookSecret?: string; baseUrl?: string }) {
    // Mesmo padrão de src/lib/brevo.ts e src/lib/resend.ts: lê do process.env,
    // sem schema central (o projeto não tem um).
    this.apiKey = config?.apiKey ?? process.env.ABACATEPAY_API_KEY ?? ""
    this.webhookSecret = config?.webhookSecret ?? process.env.ABACATEPAY_WEBHOOK_SECRET ?? ""
    this.baseUrl = config?.baseUrl ?? process.env.ABACATEPAY_BASE_URL ?? BASE_URL_PADRAO
  }

  async criarCobrancaPix(params: CriarCobrancaPixParams): Promise<CobrancaPixCriada> {
    if (!this.apiKey) {
      throw new Error(
        "ABACATEPAY_API_KEY não configurada — impossível criar cobrança Pix."
      )
    }

    const corpo = {
      method: "PIX",
      data: {
        // O provedor trabalha em CENTAVOS. Math.round e não Math.trunc por
        // causa do float binário: 10.07 * 100 dá 1006.9999999999999 em JS.
        amount: Math.round(params.valor * 100),
        description: params.descricao,
        expiresIn: params.expira_em_segundos,
        ...(params.cliente && {
          customer: {
            name: params.cliente.nome,
            email: params.cliente.email,
            taxId: params.cliente.documento,
            cellphone: params.cliente.telefone,
          },
        }),
        metadata: { vendaId: params.venda_id },
      },
      // TODO(#52, split de R$ 0,80): a documentação pública do
      // /transparents/create NÃO mostra campo para o lojista declarar o split.
      // O `platformFee` aparece só na RESPOSTA, o que sugere que a retenção é
      // configurada na conta/parceria e não por requisição. Confirmar com a
      // AbacatePay (suporte ou docs de marketplace) antes de ligar em produção:
      //   1. o split é por requisição (campo aqui) ou por configuração da conta?
      //   2. se for por requisição, qual o nome exato do campo?
      //   3. R$ 0,80 é valor fixo ou entra como percentual?
      // Enquanto isso, a asserção "envia o split" do critério de aceite da #52
      // NÃO está cumprida — está apenas isolada aqui, num ponto só.
    }

    const resposta = await fetch(`${this.baseUrl}/transparents/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
    })

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => "")
      throw new BadRequestError(
        `A AbacatePay recusou a cobrança (HTTP ${resposta.status}).`,
        "GATEWAY_PAGAMENTO_ERRO",
        { status: resposta.status, resposta: texto.slice(0, 500) }
      )
    }

    const json = (await resposta.json()) as RespostaTransparent
    const data = json.data

    if (!data?.id || !data.brCode || !data.brCodeBase64) {
      throw new BadRequestError(
        "Resposta da AbacatePay sem os campos obrigatórios da cobrança Pix.",
        "GATEWAY_PAGAMENTO_RESPOSTA_INVALIDA",
        { erro: json.error ?? null }
      )
    }

    return {
      payment_id: data.id,
      qr_code: data.brCode,
      qr_code_imagem: data.brCodeBase64,
      expira_em: data.expiresAt ? new Date(data.expiresAt) : new Date(),
      // platformFee vem em centavos, como todo valor do provedor.
      taxa_plataforma:
        typeof data.platformFee === "number" ? data.platformFee / 100 : null,
    }
  }

  async consultarCobrancaPix(paymentId: string): Promise<StatusCobrancaPix> {
    return this.chamarStatus("GET", "/transparents/check", paymentId)
  }

  async simularPagamentoPix(paymentId: string): Promise<StatusCobrancaPix> {
    return this.chamarStatus("POST", "/transparents/simulate-payment", paymentId)
  }

  /**
   * `check` e `simulate-payment` têm a MESMA forma: id na query string e o
   * mesmo envelope de resposta. O que muda é só o verbo e o caminho.
   */
  private async chamarStatus(
    metodo: "GET" | "POST",
    caminho: string,
    paymentId: string
  ): Promise<StatusCobrancaPix> {
    if (!this.apiKey) {
      throw new Error("ABACATEPAY_API_KEY não configurada.")
    }

    // O id vai na QUERY STRING, não no caminho — inclusive no POST de
    // simulate-payment, que não tem corpo.
    const url = new URL(`${this.baseUrl}${caminho}`)
    url.searchParams.set("id", paymentId)

    const resposta = await fetch(url.toString(), {
      method: metodo,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => "")
      throw new BadRequestError(
        `A AbacatePay recusou a consulta (HTTP ${resposta.status}).`,
        "GATEWAY_PAGAMENTO_ERRO",
        { status: resposta.status, resposta: texto.slice(0, 500) }
      )
    }

    const json = (await resposta.json()) as RespostaTransparent
    const data = json.data

    if (!data?.id || !data.status) {
      throw new BadRequestError(
        "Resposta da AbacatePay sem id ou status da cobrança.",
        "GATEWAY_PAGAMENTO_RESPOSTA_INVALIDA",
        { erro: json.error ?? null }
      )
    }

    const status = data.status as StatusCobranca

    return {
      payment_id: data.id,
      status,
      // Só PAID vale como dinheiro na conta. APPROVED existe em outros fluxos
      // do provedor e NÃO significa pagamento liquidado — tratar como pago
      // daria baixa de estoque em venda que pode não ter sido paga.
      pago: status === "PAID",
      expira_em: data.expiresAt ? new Date(data.expiresAt) : null,
    }
  }

  /**
   * RNF02. HMAC-SHA256 do corpo CRU, digest em base64, comparado em tempo
   * constante — exatamente o exemplo em Node da documentação deles.
   *
   * `timingSafeEqual` estoura se os buffers têm tamanhos diferentes, por isso a
   * comparação de length vem antes. Ela também é o motivo de não usar `===`:
   * comparar strings sai cedo no primeiro byte diferente, e esse tempo vaza
   * quantos bytes do prefixo o atacante já acertou.
   */
  verificarAssinaturaWebhook(corpoCru: Buffer, assinatura: string | undefined): boolean {
    if (!this.webhookSecret) {
      throw new Error(
        "ABACATEPAY_WEBHOOK_SECRET não configurada — impossível validar o webhook."
      )
    }

    if (!assinatura) return false

    const esperada = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(corpoCru)
      .digest("base64")

    const a = Buffer.from(esperada)
    const b = Buffer.from(assinatura)

    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }
}
