import type { Role } from "../../../../generated/prisma/client.js"
import { ForbiddenError, NfceNaoElegivelError, NotFoundError } from "@/shared/errors"
import type { PlanoService } from "@/modules/billing/service/PlanoService"
import type { INfceEmissor } from "../emissor/INfceEmissor"
import type { DadosParaNota, FormaPagamentoNota } from "../espelho"
import { renderizarEspelhoHtml } from "../render/renderizarEspelhoHtml"
import type {
  INfceRepository,
  NotaRegistrada,
  VendaParaNota,
} from "../repository/INfceRepository"

export type MotivoNaoElegivel = "VENDA_NAO_PAGA" | "SWITCH_DESLIGADO" | "PLANO_FREE"

export type ResultadoEmissao =
  | { resultado: "EMITIDA" | "JA_EMITIDA" }
  | { resultado: "NAO_ELEGIVEL"; motivo: MotivoNaoElegivel | "VENDA_NAO_ENCONTRADA" }

const FORMA_DE_PAGAMENTO: Record<VendaParaNota["metodo_pagamento"], FormaPagamentoNota> = {
  PIX_ABACATEPAY: "PIX",
  DINHEIRO: "DINHEIRO",
  DEBITO: "DEBITO",
  CREDITO: "CREDITO",
}

/** Dinheiro em centavos inteiros: somar e subtrair sem a dízima do float. */
const centavos = (valor: number) => Math.round(valor * 100)
const reais = (valorEmCentavos: number) => valorEmCentavos / 100

/**
 * NFC-e SIMULADA (D3, issue #81).
 *
 * Depois que a venda é paga, e se o Switch Fiscal está ligado numa loja
 * Premium, gera-se o "espelho" da nota, que fica guardado e pode ser
 * consultado e impresso. NADA aqui tem valor fiscal e nenhuma saída esconde
 * isso.
 *
 * A falha ao gerar a nota NUNCA desfaz nem trava a venda: ela já foi paga e
 * o estoque já baixou. Fica registrada como ERRO e pode ser reemitida.
 */
export class NfceService {
  constructor(
    private nfceRepository: INfceRepository,
    private planoService: PlanoService,
    private emissor: INfceEmissor
  ) {}

  /**
   * Gatilho do PDV, chamado logo depois de a venda virar PAGA (dinheiro,
   * cartão ou Pix consolidado). Nunca lança: o caixa não pode ver erro fiscal
   * numa venda que deu certo.
   */
  async emitirAposPagamento(vendaId: string): Promise<void> {
    try {
      await this.emitirParaVenda(vendaId)
    } catch {
      // Já ficou registrado como ERRO na própria venda (ver `emitirParaVenda`);
      // dá para reemitir por `POST /nfce/vendas/:venda_id/emitir`.
    }
  }

  /**
   * Reemissão pelo painel (venda que ficou em ERRO, ou que foi paga antes do
   * Switch ser ligado). Idempotente: se a nota já existe, devolve a existente.
   */
  async emitirManual(
    vendaId: string,
    estabelecimentoId: string,
    role: Role
  ): Promise<{ criada: boolean; nota: NotaRegistrada }> {
    this.garantirPodeEmitir(role)

    const venda = await this.nfceRepository.findVendaParaNota(vendaId)

    // Venda de outra loja é indistinguível de inexistente, de propósito.
    if (!venda || venda.estabelecimento_id !== estabelecimentoId) {
      throw new NotFoundError("Venda não encontrada nesta loja.", "VENDA_NAO_ENCONTRADA")
    }

    const resultado = await this.emitirParaVenda(vendaId)

    if (resultado.resultado === "NAO_ELEGIVEL") {
      if (resultado.motivo === "VENDA_NAO_ENCONTRADA") {
        throw new NotFoundError("Venda não encontrada nesta loja.", "VENDA_NAO_ENCONTRADA")
      }

      throw new NfceNaoElegivelError(resultado.motivo)
    }

    const nota = await this.nfceRepository.findNota(vendaId, estabelecimentoId)

    return { criada: resultado.resultado === "EMITIDA", nota: nota as NotaRegistrada }
  }

  /** Listagem das notas da loja ativa, da mais nova para a mais antiga. */
  async listar(estabelecimentoId: string, page: number, limit: number) {
    const { data, total } = await this.nfceRepository.listar(estabelecimentoId, { page, limit })

    return { data, total, page, limit }
  }

  async consultar(vendaId: string, estabelecimentoId: string): Promise<NotaRegistrada> {
    const nota = await this.nfceRepository.findNota(vendaId, estabelecimentoId)

    // Nota de outra loja é indistinguível de inexistente, de propósito.
    if (!nota) {
      throw new NotFoundError("NFC-e simulada não encontrada nesta loja.", "NFCE_NAO_ENCONTRADA")
    }

    return nota
  }

  /** HTML imprimível, gerado do retrato guardado (o aviso vem sempre do código). */
  async imprimir(vendaId: string, estabelecimentoId: string): Promise<string> {
    const nota = await this.consultar(vendaId, estabelecimentoId)

    return renderizarEspelhoHtml(nota.espelho)
  }

  private garantirPodeEmitir(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem reemitir NFC-e.",
        "ROLE_CANNOT_EMIT_NFCE"
      )
    }
  }

  private async emitirParaVenda(vendaId: string): Promise<ResultadoEmissao> {
    const venda = await this.nfceRepository.findVendaParaNota(vendaId)

    if (!venda) {
      return { resultado: "NAO_ELEGIVEL", motivo: "VENDA_NAO_ENCONTRADA" }
    }

    if (venda.status_pagamento !== "PAGO") {
      return { resultado: "NAO_ELEGIVEL", motivo: "VENDA_NAO_PAGA" }
    }

    // Nota já emitida vale mesmo que o Switch tenha sido desligado depois: o
    // histórico não some quando a loja é rebaixada.
    if (venda.nfe_numero !== null) {
      return { resultado: "JA_EMITIDA" }
    }

    // O Switch já exigiu Premium para ligar (#59), mas a assinatura pode ter
    // caído depois (#67 desliga o Switch; esta checagem cobre a janela entre os
    // dois e qualquer inconsistência).
    if (!venda.estabelecimento.emite_nfce) {
      return { resultado: "NAO_ELEGIVEL", motivo: "SWITCH_DESLIGADO" }
    }

    const { plano } = await this.planoService.obterPlano(venda.estabelecimento_id)

    if (plano !== "PREMIUM") {
      return { resultado: "NAO_ELEGIVEL", motivo: "PLANO_FREE" }
    }

    const dados = this.montarDados(venda)

    try {
      const { criada } = await this.nfceRepository.registrarNota({
        venda_id: venda.id,
        gerar: (numero) => this.emissor.emitir(dados, numero),
      })

      return { resultado: criada ? "EMITIDA" : "JA_EMITIDA" }
    } catch (error) {
      await this.nfceRepository.registrarErro(
        venda.id,
        error instanceof Error ? error.message : "Falha ao gerar a NFC-e simulada."
      )

      throw error
    }
  }

  private montarDados(venda: VendaParaNota): DadosParaNota {
    const itens = venda.itens.map((item) => ({
      nome: item.produto.nome,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
      total: Number(item.subtotal),
    }))

    const subtotal = itens.reduce((soma, item) => soma + centavos(item.total), 0)
    const totalVenda = centavos(venda.total_venda.toNumber())
    // D1: a taxa só existe no Pix. Em dinheiro e cartão fica null e a nota não
    // tem a linha.
    const taxa =
      venda.metodo_pagamento === "PIX_ABACATEPAY" && venda.taxa_split
        ? centavos(venda.taxa_split.toNumber())
        : null

    return {
      venda_id: venda.id,
      estabelecimento: {
        nome: venda.estabelecimento.nome,
        cnpj: venda.estabelecimento.cnpj,
        ie: venda.estabelecimento.ie,
      },
      // RN03 da Fase 4: sem cliente, "Consumidor Não Identificado".
      consumidor: venda.cliente
        ? { identificado: true, nome: venda.cliente.nome, cpf: venda.cliente.cpf }
        : { identificado: false, nome: null, cpf: null },
      itens,
      subtotal_itens: reais(subtotal),
      desconto: reais(Math.max(subtotal - totalVenda, 0)),
      total_venda: reais(totalVenda),
      taxa_pix: taxa === null ? null : reais(taxa),
      total_cobrado: reais(totalVenda + (taxa ?? 0)),
      forma_pagamento: FORMA_DE_PAGAMENTO[venda.metodo_pagamento],
      pago_em: venda.pago_em ? venda.pago_em.toISOString() : null,
    }
  }
}
