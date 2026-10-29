import type {
  Assinatura,
  Role,
  StatusAssinatura,
  TipoPlano,
} from "../../../../generated/prisma/client.js"
import {
  AssinaturaJaCanceladaError,
  AssinaturaJaExistenteError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors"
import type { IEstabelecimentoRepository } from "@/modules/estabelecimento/repository/IEstabelecimentoRepository"
import { PRECO_PREMIUM, TRIAL_DIAS } from "../planos"
import type {
  AssinaturaDoProvedor,
  IAssinaturaGateway,
} from "../gateway/IAssinaturaGateway"
import type { IAssinaturaRepository } from "../repository/IAssinaturaRepository"
import type { IPlanoRepository } from "../repository/IPlanoRepository"

export interface UsuarioDaAssinatura {
  email: string
}

export interface AssinaturaIniciada {
  checkout_id: string
  checkout_url: string
  tipo_plano: TipoPlano
  trial_dias: number
  valor: number
}

/**
 * Eventos de assinatura da AbacatePay que mexem no plano da loja. O resto
 * (`subscription.plan_changed`, por exemplo) não tem efeito aqui: só vendemos
 * um plano por ciclo.
 */
const EVENTOS_ASSINATURA = new Set([
  "subscription.completed",
  "subscription.trial_started",
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.cancelled",
])

export function ehEventoDeAssinatura(evento: string): boolean {
  return EVENTOS_ASSINATURA.has(evento)
}

/**
 * Fases 5 — issues #65, #66 e #67 (D2: só cartão, AbacatePay em modo Dev).
 *
 * O ciclo: a loja pede o checkout (`iniciar`), o cliente informa o cartão na
 * página da AbacatePay, e a partir daí QUEM MANDA É O WEBHOOK
 * (`processarEventoWebhook`): trial -> ativa -> (inadimplente) -> cancelada.
 *
 * Duas regras que atravessam tudo:
 * - **RN04:** `iniciar` NÃO grava `Assinatura`. Gravar ali (mesmo em TRIALING)
 *   faria a loja virar Premium antes de a AbacatePay confirmar o cartão, pois o
 *   plano é derivado do status (RN00). A linha só nasce no webhook.
 * - **O evento é gatilho, não verdade.** O payload dos eventos não é
 *   documentado; o estado vem de uma consulta direta à AbacatePay, e `CANCELLED`
 *   no provedor vence qualquer evento. Assim um reenvio, ou eventos fora de
 *   ordem, levam sempre ao mesmo estado.
 */
export class AssinaturaService {
  constructor(
    private planoRepository: IPlanoRepository,
    private assinaturaRepository: IAssinaturaRepository,
    private estabelecimentoRepository: IEstabelecimentoRepository,
    private gateway: IAssinaturaGateway,
    private agora: () => Date = () => new Date()
  ) {}

  /**
   * RN04/05 (Fase 1): o Gestor é bloqueado em ações críticas, e o plano Premium
   * é uma delas. Só Owner (e o Admin da plataforma) contrata e cancela.
   */
  private garantirAcesso(role: Role) {
    if (role !== "OWNER" && role !== "ADMIN") {
      throw new ForbiddenError(
        "Apenas o Owner da loja pode gerenciar a assinatura.",
        "ROLE_CANNOT_MANAGE_PLANO"
      )
    }
  }

  /** RF01.2 + RN04 (#65): cria o checkout do trial Premium, só no cartão. */
  async iniciar(
    estabelecimentoId: string,
    role: Role,
    usuario: UsuarioDaAssinatura,
    tipoPlano: TipoPlano
  ): Promise<AssinaturaIniciada> {
    this.garantirAcesso(role)

    // O trial é um só por loja: qualquer assinatura já registrada, em qualquer
    // status, barra um segundo trial.
    const existente =
      await this.planoRepository.findAssinaturaByEstabelecimento(estabelecimentoId)

    if (existente) {
      throw new AssinaturaJaExistenteError(existente.status)
    }

    const estabelecimento = await this.estabelecimentoRepository.findById(estabelecimentoId)

    if (!estabelecimento) {
      throw new NotFoundError("Estabelecimento não encontrado.")
    }

    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")

    const checkout = await this.gateway.criarCheckoutAssinatura({
      estabelecimento_id: estabelecimentoId,
      tipo_plano: tipoPlano,
      cliente: {
        email: usuario.email,
        // O cliente da AbacatePay é a loja: nome e CNPJ dela, e-mail de quem contrata.
        nome: estabelecimento.nome,
        documento: estabelecimento.cnpj.replace(/\D/g, ""),
      },
      url_retorno: `${appUrl}/ajustes`,
      url_conclusao: `${appUrl}/ajustes?assinatura=concluida`,
    })

    return {
      checkout_id: checkout.checkout_id,
      checkout_url: checkout.url,
      tipo_plano: tipoPlano,
      trial_dias: TRIAL_DIAS,
      valor: PRECO_PREMIUM[tipoPlano === "MENSAL" ? "MENSAL" : "ANUAL"],
    }
  }

  /** #66: cancela já, sem cobranças futuras, e a loja volta aos limites do Free. */
  async cancelar(estabelecimentoId: string, role: Role): Promise<Assinatura> {
    this.garantirAcesso(role)

    const atual = await this.planoRepository.findAssinaturaByEstabelecimento(estabelecimentoId)

    if (!atual) {
      throw new NotFoundError(
        "Esta loja não tem assinatura para cancelar.",
        "ASSINATURA_NAO_ENCONTRADA"
      )
    }

    if (atual.status === "CANCELED") {
      throw new AssinaturaJaCanceladaError()
    }

    if (atual.abacatepay_sub_id) {
      await this.gateway.cancelarAssinatura(atual.abacatepay_sub_id)
    }

    return this.assinaturaRepository.salvar({
      estabelecimento_id: estabelecimentoId,
      abacatepay_sub_id: atual.abacatepay_sub_id ?? "",
      abacatepay_customer_id: atual.abacatepay_customer_id ?? "",
      status: "CANCELED",
      tipo_plano: atual.tipo_plano,
      trial_expira_em: atual.trial_expira_em,
      periodo_atual_fim: atual.periodo_atual_fim,
      desligar_nfce: true,
    })
  }

  /**
   * #67. Chamado pelo webhook (rota pública, sem loja). Devolve `processado:
   * true` só quando ESTA chamada mudou o estado da loja — reenvio do mesmo
   * evento devolve false e não escreve nada.
   *
   * Aceita vários ids candidatos porque o formato de `data` não é documentado:
   * o primeiro que a AbacatePay reconhece e que aponta para uma loja nossa vale.
   */
  async processarEventoWebhook(
    evento: string,
    ids: string[]
  ): Promise<{ processado: boolean }> {
    if (!ehEventoDeAssinatura(evento)) {
      return { processado: false }
    }

    for (const id of ids) {
      const remota = await this.gateway.consultarAssinatura(id)

      // Sem loja nossa no externalId = assinatura de outro sistema na mesma
      // conta. Não é erro: o provedor reenviaria para sempre.
      if (!remota?.estabelecimento_id) continue

      const estabelecimento = await this.estabelecimentoRepository.findById(
        remota.estabelecimento_id
      )

      if (!estabelecimento) continue

      return { processado: await this.aplicar(evento, remota) }
    }

    return { processado: false }
  }

  /**
   * Rede de segurança do trial (#66): o primeiro débito é em `trial_expira_em`
   * e o evento dessa cobrança não é documentado. Se a loja ainda está em
   * TRIALING com o trial vencido, pergunta ao provedor em vez de dar Premium
   * de graça para sempre. Chamado na consulta da assinatura; falha do provedor
   * nunca derruba a consulta.
   */
  async reconciliarTrialVencido(estabelecimentoId: string): Promise<void> {
    const atual = await this.planoRepository.findAssinaturaByEstabelecimento(estabelecimentoId)

    if (
      !atual ||
      atual.status !== "TRIALING" ||
      !atual.abacatepay_sub_id ||
      !atual.trial_expira_em ||
      atual.trial_expira_em > this.agora()
    ) {
      return
    }

    try {
      const remota = await this.gateway.consultarAssinatura(atual.abacatepay_sub_id)

      if (remota?.estabelecimento_id === estabelecimentoId) {
        await this.aplicar("reconciliacao", remota)
      }
    } catch {
      // Provedor fora do ar: segue com o que há. A próxima consulta tenta de novo.
    }
  }

  private async aplicar(evento: string, remota: AssinaturaDoProvedor): Promise<boolean> {
    const estabelecimentoId = remota.estabelecimento_id as string
    const atual = await this.planoRepository.findAssinaturaByEstabelecimento(estabelecimentoId)
    const agora = this.agora()

    // Segundo checkout pago por uma loja que já tem assinatura valendo: o trial
    // é um só (#65), então o duplicado não sobrescreve a assinatura em vigor.
    if (
      atual?.abacatepay_sub_id &&
      atual.abacatepay_sub_id !== remota.subscription_id &&
      (atual.status === "TRIALING" || atual.status === "ACTIVE")
    ) {
      return false
    }

    const status = this.derivarStatus(evento, remota, agora)

    // Checkout ainda não pago: nada a registrar. (RN04: sem cartão confirmado,
    // a loja continua Free.)
    if (status === null) return false

    const tipoPlano = remota.tipo_plano ?? atual?.tipo_plano ?? "MENSAL"
    const periodoAtualFim = this.derivarFimDoPeriodo(status, tipoPlano, remota, atual, agora)
    const mesmaAssinatura = atual?.abacatepay_sub_id === remota.subscription_id

    const mudou =
      !atual ||
      !mesmaAssinatura ||
      atual.status !== status ||
      atual.tipo_plano !== tipoPlano ||
      atual.trial_expira_em?.getTime() !== remota.trial_expira_em?.getTime() ||
      atual.periodo_atual_fim?.getTime() !== periodoAtualFim?.getTime()

    if (!mudou) return false

    await this.assinaturaRepository.salvar({
      estabelecimento_id: estabelecimentoId,
      abacatepay_sub_id: remota.subscription_id,
      abacatepay_customer_id: remota.customer_id,
      status,
      tipo_plano: tipoPlano,
      trial_expira_em: remota.trial_expira_em,
      periodo_atual_fim: periodoAtualFim,
      // RN03: inadimplente ou cancelada = NFC-e desligada na hora.
      desligar_nfce: status === "PAST_DUE" || status === "CANCELED",
    })

    return true
  }

  /**
   * Estado da loja a partir do evento E do que a AbacatePay responde agora.
   * `null` = nada a fazer (checkout ainda não pago).
   */
  private derivarStatus(
    evento: string,
    remota: AssinaturaDoProvedor,
    agora: Date
  ): StatusAssinatura | null {
    // O provedor manda: cancelada lá é cancelada aqui, qualquer que seja o
    // evento (reenvio atrasado, eventos fora de ordem).
    if (remota.status === "CANCELLED" || evento === "subscription.cancelled") {
      return "CANCELED"
    }

    if (remota.status === "PENDING") return null

    if (evento === "subscription.payment_failed") return "PAST_DUE"

    // ACTIVE no provedor: ainda dentro do trial é TRIALING; passou do fim do
    // trial (primeira cobrança feita) é ACTIVE.
    return remota.trial_expira_em && remota.trial_expira_em > agora ? "TRIALING" : "ACTIVE"
  }

  /**
   * Fim do período vigente. O provedor não devolve a próxima cobrança, então em
   * ACTIVE é uma ESTIMATIVA (agora + ciclo); serve para exibição, não para
   * decidir acesso. Um reenvio do mesmo evento antes do fim do período não
   * empurra a data para frente.
   */
  private derivarFimDoPeriodo(
    status: StatusAssinatura,
    tipoPlano: TipoPlano,
    remota: AssinaturaDoProvedor,
    atual: Assinatura | null,
    agora: Date
  ): Date | null {
    if (status === "TRIALING") return remota.trial_expira_em

    if (status !== "ACTIVE") return atual?.periodo_atual_fim ?? null

    // Já ACTIVE com período vigente: reenvio do evento, não renovação nova. Uma
    // renovação de verdade só chega depois do fim do período.
    if (atual?.status === "ACTIVE" && atual.periodo_atual_fim && atual.periodo_atual_fim > agora) {
      return atual.periodo_atual_fim
    }

    const fim = new Date(agora)

    if (tipoPlano === "ANUAL") {
      fim.setFullYear(fim.getFullYear() + 1)
    } else {
      fim.setMonth(fim.getMonth() + 1)
    }

    return fim
  }
}
