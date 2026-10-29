import { randomUUID } from "node:crypto"
import { Prisma, type Cupom } from "../../../../generated/prisma/client.js"
import {
  NotFoundError,
  TurnoFechadoError,
  ValorPagoInsuficienteError,
} from "@/shared/errors"
import type { ICaixaRepository } from "@/modules/caixa/repository/ICaixaRepository"
import type { IVendaRepository } from "@/modules/venda/repository/IVendaRepository"
import type { VendaService } from "@/modules/venda/service/VendaService"
import type { VendaComItens } from "@/modules/venda/dto/venda.dto"
import type { ClienteService } from "@/modules/crm/service/ClienteService"
import type { CupomService } from "@/modules/crm/service/CupomService"
import type { IniciarPagamentoPixDTO, RegistrarPagamentoDTO } from "../dto/pagamento.dto"
import type {
  CobrancaPixCriada,
  IPagamentoGateway,
  StatusCobrancaPix,
} from "../gateway/IPagamentoGateway"
import { PIX_EXPIRA_EM_SEGUNDOS, TAXA_PIX_REAIS } from "../taxa-pix"
import type { NfceService } from "@/modules/nfce/service/NfceService"

export interface PagamentoRegistrado {
  venda: VendaComItens
  /** Soma dos itens, antes do desconto. */
  subtotal: number
  desconto: number
  cupom_codigo: string | null
  valor_pago: number | null
  troco: number | null
}

export interface PixIniciado {
  venda: VendaComItens
  subtotal: number
  desconto: number
  cupom_codigo: string | null
  /** D1: a taxa que o consumidor paga a mais no Pix. */
  taxa_pix: number
  /** `total_venda + taxa_pix`: o valor do QR Code. */
  total_cobrado: number
  cobranca: CobrancaPixCriada
}

export interface PixSincronizado {
  venda: VendaComItens
  status: StatusCobrancaPix
  /** `true` só quando ESTA chamada baixou o estoque (ver `ConsolidacaoPix`). */
  consolidada: boolean
}

/** Status do provedor em que o QR Code morreu sem dinheiro na conta. */
const COBRANCA_MORTA = new Set(["EXPIRED", "CANCELLED", "FAILED"])

/**
 * RF02.1/RF02.2 + RNF01 — issue #51.
 *
 * Sem `garantirAcesso`: vender é o trabalho do Caixa. Por isso o fluxo usa o
 * `IVendaRepository`/`IEstoqueRepository` direto e NUNCA o `EstoqueService` —
 * aquele bloqueia CASHIER com 403, e toda venda feita por um caixa falharia.
 * Pelo mesmo motivo o cupom é validado pelo `CupomService.validarParaResgate`,
 * que não tem trava de cargo (só a EMISSÃO de cupom tem).
 */
export class PagamentoService {
  constructor(
    private vendaRepository: IVendaRepository,
    private vendaService: VendaService,
    private caixaRepository: ICaixaRepository,
    private clienteService: ClienteService,
    private cupomService: CupomService,
    private gateway: IPagamentoGateway,
    /**
     * NFC-e simulada (D3). Opcional porque a venda funciona sem ela: só as rotas de
     * produção a injetam, e os testes de venda não precisam.
     */
    private nfceService?: NfceService
  ) {}

  async registrarPagamentoManual(
    estabelecimentoId: string,
    usuarioId: string,
    data: RegistrarPagamentoDTO
  ): Promise<PagamentoRegistrado> {
    const { turno, carrinho, cupom, total, desconto } = await this.prepararVenda(
      estabelecimentoId,
      data
    )
    const troco = this.calcularTroco(data, total)

    // A transação inteira (Venda + itens + resgate do cupom + baixa de estoque
    // + auditoria) vive no repositório. Se qualquer parte falhar, nada disso
    // fica gravado — RNF01.
    const venda = await this.vendaRepository.registrarVendaPaga({
      estabelecimento_id: estabelecimentoId,
      usuario_id: usuarioId,
      turno_id: turno.id,
      cliente_id: data.cliente_id,
      metodo_pagamento: data.metodo_pagamento,
      total_venda: total,
      cupom_id: cupom?.id,
      itens: carrinho.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        subtotal: item.subtotal,
      })),
    })

    // D3: venda paga -> NFC-e simulada, se a loja tem o Switch ligado. Fora da
    // transação da venda e sem nunca lançar: a nota não pode desfazer a venda.
    await this.nfceService?.emitirAposPagamento(venda.id)

    return {
      venda,
      subtotal: carrinho.total,
      desconto,
      cupom_codigo: cupom?.codigo ?? null,
      valor_pago: data.valor_pago ?? null,
      troco,
    }
  }

  /**
   * RF03.1 + D1. Cria a venda como PENDENTE e o QR Code do Pix, cobrando
   * `total + R$ 0,80`. Nada de estoque aqui (RN01): a baixa espera o pagamento
   * — ver `sincronizarPix`.
   *
   * A cobrança é criada ANTES da venda: se o provedor recusar, não sobra venda
   * PENDENTE nem cupom consumido à toa. No sentido inverso (cobrança criada e o
   * banco falha) sobra um QR Code que ninguém vai pagar e que expira sozinho.
   */
  async registrarPagamentoPix(
    estabelecimentoId: string,
    usuarioId: string,
    data: IniciarPagamentoPixDTO
  ): Promise<PixIniciado> {
    const { turno, carrinho, cupom, total, desconto } = await this.prepararVenda(
      estabelecimentoId,
      data
    )

    // Decimal: em float, 10.07 + 0.8 não é 10.87 exato, e o provedor recebe
    // centavos inteiros.
    const totalCobrado = Number(
      new Prisma.Decimal(total.toString()).add(TAXA_PIX_REAIS.toString())
    )

    const vendaId = randomUUID()

    const cobranca = await this.gateway.criarCobrancaPix({
      valor: totalCobrado,
      descricao: `Venda ${vendaId}`,
      expira_em_segundos: PIX_EXPIRA_EM_SEGUNDOS,
      venda_id: vendaId,
    })

    const venda = await this.vendaRepository.registrarVendaPixPendente({
      id: vendaId,
      estabelecimento_id: estabelecimentoId,
      usuario_id: usuarioId,
      turno_id: turno.id,
      cliente_id: data.cliente_id,
      // Receita da loja: itens menos cupom. A taxa fica à parte, em
      // `taxa_split`, para o CRM e o fechamento não contarem a taxa como venda.
      total_venda: total,
      taxa_split: TAXA_PIX_REAIS,
      abacatepay_payment_id: cobranca.payment_id,
      cupom_id: cupom?.id,
      itens: carrinho.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        subtotal: item.subtotal,
      })),
    })

    return {
      venda,
      subtotal: carrinho.total,
      desconto,
      cupom_codigo: cupom?.codigo ?? null,
      taxa_pix: TAXA_PIX_REAIS,
      total_cobrado: totalCobrado,
      cobranca,
    }
  }

  /** Polling do PDV. Escopado por loja: cobrança de outra loja é 404. */
  async consultarPix(estabelecimentoId: string, paymentId: string): Promise<PixSincronizado> {
    const venda = await this.buscarVendaPix(estabelecimentoId, paymentId)
    const status = await this.gateway.consultarCobrancaPix(paymentId)

    return this.sincronizarPix(venda, status)
  }

  /** SOMENTE DESENVOLVIMENTO — ver o aviso em routes.ts. */
  async simularPix(estabelecimentoId: string, paymentId: string): Promise<PixSincronizado> {
    const venda = await this.buscarVendaPix(estabelecimentoId, paymentId)
    const status = await this.gateway.simularPagamentoPix(paymentId)

    return this.sincronizarPix(venda, status)
  }

  /**
   * #79. Chamado pelo webhook (rota pública, sem loja). O corpo do evento NÃO
   * é confiado para dar baixa: a documentação não descreve o payload do
   * `transparent.completed`, e a venda só vira PAGA se o provedor confirmar
   * `PAID` numa consulta direta. O evento é só o gatilho.
   *
   * Aceita vários ids candidatos porque o formato de `data` não é documentado:
   * o primeiro que casa com uma venda nossa vale. Id desconhecido (cobrança de
   * outro sistema na mesma conta) não é erro — `processado: false`, nunca 404,
   * senão o provedor reenvia para sempre.
   */
  async confirmarPixPorWebhook(paymentIds: string[]): Promise<{ processado: boolean }> {
    for (const paymentId of paymentIds) {
      const venda = await this.vendaRepository.findByPaymentId(paymentId)

      if (!venda) continue

      // Idempotência: reenvio do webhook para venda já resolvida nem chega ao
      // provedor. O update condicional do repositório cobre a corrida.
      if (venda.status_pagamento !== "PENDENTE") {
        return { processado: false }
      }

      const status = await this.gateway.consultarCobrancaPix(paymentId)
      const { consolidada } = await this.sincronizarPix(venda, status)

      return { processado: consolidada }
    }

    return { processado: false }
  }

  private async buscarVendaPix(
    estabelecimentoId: string,
    paymentId: string
  ): Promise<VendaComItens> {
    const venda = await this.vendaRepository.findByPaymentId(paymentId)

    // Cobrança de outra loja é indistinguível de inexistente, de propósito.
    if (!venda || venda.estabelecimento_id !== estabelecimentoId) {
      throw new NotFoundError(
        "Cobrança Pix não encontrada nesta loja.",
        "COBRANCA_NAO_ENCONTRADA"
      )
    }

    return venda
  }

  /**
   * Leva a venda ao estado que o provedor informa: `PAID` consolida (PAGO +
   * baixa de estoque), cobrança expirada/cancelada cancela a PENDENTE e devolve
   * o cupom. O resto (reembolso, disputa) não muda a venda aqui.
   */
  private async sincronizarPix(
    venda: VendaComItens,
    status: StatusCobrancaPix
  ): Promise<PixSincronizado> {
    if (status.pago) {
      const { venda: atualizada, consolidada } =
        await this.vendaRepository.consolidarPagamentoPix(venda.id)

      // D3: só a chamada que de fato consolidou emite a nota. Reenvio do
      // webhook e polling repetido caem aqui com `consolidada: false`.
      if (consolidada) {
        await this.nfceService?.emitirAposPagamento(venda.id)
      }

      return { venda: atualizada, status, consolidada }
    }

    if (COBRANCA_MORTA.has(status.status) && venda.status_pagamento === "PENDENTE") {
      await this.vendaRepository.cancelarPixPendente(venda.id)

      // Relê: o cancelamento é condicional e pode ter perdido a corrida para
      // um pagamento que chegou no mesmo instante.
      const atual = await this.vendaRepository.findByPaymentId(status.payment_id)

      return { venda: atual ?? venda, status, consolidada: false }
    }

    return { venda, status, consolidada: false }
  }

  /**
   * Parte comum a toda venda: turno aberto, cliente da loja, precificação com
   * preço do banco e cupom. Compartilhada entre o pagamento manual e o Pix para
   * o total cobrado sair da MESMA regra nos dois.
   */
  private async prepararVenda(
    estabelecimentoId: string,
    data: {
      itens: IniciarPagamentoPixDTO["itens"]
      cliente_id?: string | undefined
      cupom_codigo?: string | undefined
    }
  ) {
    // Venda exige turno aberto. Sem isso, o fechamento de caixa acusaria
    // diferença todo dia sem ninguém saber se foi furo ou venda solta — e aí
    // a issue #54 perderia o sentido.
    const turno = await this.caixaRepository.findAbertoByEstabelecimento(estabelecimentoId)

    if (!turno) {
      throw new TurnoFechadoError()
    }

    // RF02.1 (#58): a venda é indexada ao cliente pelo `cliente_id`. Validar
    // aqui impede vincular cliente de OUTRA loja (a FK aceitaria) e transforma
    // um id inexistente em 404, em vez do 500 de violação de FK.
    if (data.cliente_id) {
      await this.clienteService.findById(data.cliente_id, estabelecimentoId)
    }

    // Reusa a MESMA precificação do POST /venda/calcular: é o que garante que
    // o total cobrado é o que foi mostrado ao cliente, com preço lido do banco
    // nos dois casos. Também valida produto inexistente/inativo.
    const carrinho = await this.vendaService.precificarCarrinho(
      estabelecimentoId,
      data.itens
    )

    const cupom = data.cupom_codigo
      ? await this.cupomService.validarParaResgate(
          estabelecimentoId,
          data.cupom_codigo,
          data.cliente_id
        )
      : null

    const { total, desconto } = this.aplicarDesconto(carrinho.total, cupom)

    return { turno, carrinho, cupom, total, desconto }
  }

  /**
   * O desconto nunca passa do total: cupom de R$ 20 numa compra de R$ 15 zera
   * a venda, não gera crédito nem total negativo. Decimal pelo mesmo motivo do
   * troco.
   */
  private aplicarDesconto(
    subtotal: number,
    cupom: Cupom | null
  ): { total: number; desconto: number } {
    if (!cupom) {
      return { total: subtotal, desconto: 0 }
    }

    const bruto = new Prisma.Decimal(subtotal.toString())
    const desconto = Prisma.Decimal.min(cupom.valor_desconto, bruto)

    return { total: Number(bruto.sub(desconto)), desconto: Number(desconto) }
  }

  /**
   * Troco só existe em dinheiro. Em cartão o valor é exato por definição.
   * Aritmética com Decimal: `50 - 49.9` dá 0.09999999999999432 em float, e o
   * caixa devolveria troco errado.
   */
  private calcularTroco(data: RegistrarPagamentoDTO, total: number): number | null {
    if (data.metodo_pagamento !== "DINHEIRO" || data.valor_pago === undefined) {
      return null
    }

    const pago = new Prisma.Decimal(data.valor_pago.toString())
    const totalDecimal = new Prisma.Decimal(total.toString())

    if (pago.lessThan(totalDecimal)) {
      throw new ValorPagoInsuficienteError(total, data.valor_pago)
    }

    return Number(pago.sub(totalDecimal).toDecimalPlaces(2))
  }
}
