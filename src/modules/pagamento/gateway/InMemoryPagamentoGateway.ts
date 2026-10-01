import crypto from "node:crypto"
import { randomUUID } from "node:crypto"
import { NotFoundError } from "@/shared/errors"
import type {
  CobrancaPixCriada,
  CriarCobrancaPixParams,
  IPagamentoGateway,
  StatusCobranca,
  StatusCobrancaPix,
} from "./IPagamentoGateway"

/**
 * Dublê da AbacatePay para os testes: nenhuma chamada de rede, nenhuma chave de
 * API. A assinatura usa o MESMO algoritmo do gateway real (HMAC-SHA256 do corpo
 * cru em base64), então o e2e do webhook exercita a verificação de verdade — o
 * que é dublado é só o provedor, não a criptografia.
 */
export class InMemoryPagamentoGateway implements IPagamentoGateway {
  /** Cobranças criadas, para os testes inspecionarem o que foi pedido. */
  public readonly cobrancas: Array<CriarCobrancaPixParams & { payment_id: string }> = []

  constructor(private readonly webhookSecret = "segredo-de-teste") {}

  /** Status por payment_id, para os testes controlarem o ciclo da cobrança. */
  private readonly status = new Map<string, StatusCobranca>()

  async criarCobrancaPix(params: CriarCobrancaPixParams): Promise<CobrancaPixCriada> {
    const payment_id = `pix_char_${randomUUID()}`
    this.cobrancas.push({ ...params, payment_id })
    this.status.set(payment_id, "PENDING")

    return {
      payment_id,
      qr_code: "00020160014BR.GOV.BCB.PIX070503***6304ABCD",
      qr_code_imagem: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      expira_em: new Date(Date.now() + params.expira_em_segundos * 1000),
      taxa_plataforma: 0.8,
    }
  }

  async consultarCobrancaPix(paymentId: string): Promise<StatusCobrancaPix> {
    const status = this.status.get(paymentId)

    if (!status) {
      throw new NotFoundError("Cobrança não encontrada.", "COBRANCA_NAO_ENCONTRADA")
    }

    return {
      payment_id: paymentId,
      status,
      pago: status === "PAID",
      expira_em: null,
    }
  }

  async simularPagamentoPix(paymentId: string): Promise<StatusCobrancaPix> {
    if (!this.status.has(paymentId)) {
      throw new NotFoundError("Cobrança não encontrada.", "COBRANCA_NAO_ENCONTRADA")
    }

    this.status.set(paymentId, "PAID")
    return this.consultarCobrancaPix(paymentId)
  }

  /** Helper de teste: força um status qualquer (expirada, cancelada...). */
  definirStatus(paymentId: string, status: StatusCobranca) {
    this.status.set(paymentId, status)
  }

  verificarAssinaturaWebhook(corpoCru: Buffer, assinatura: string | undefined): boolean {
    if (!assinatura) return false

    const esperada = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(corpoCru)
      .digest("base64")

    const a = Buffer.from(esperada)
    const b = Buffer.from(assinatura)

    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  /** Helper de teste: assina um corpo como o provedor assinaria. */
  assinar(corpo: string): string {
    return crypto
      .createHmac("sha256", this.webhookSecret)
      .update(Buffer.from(corpo, "utf8"))
      .digest("base64")
  }
}
