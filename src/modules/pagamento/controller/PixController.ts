import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type { PagamentoService } from "../service/PagamentoService"
import type { IniciarPagamentoPixDTO } from "../dto/pagamento.dto"
import { toStatusCobrancaResponse, type PaymentIdParams } from "../dto/pix.dto"

export class PixController {
  constructor(private pagamentoService: PagamentoService) {}

  /** RF03.1 + D1: cria a venda PENDENTE e o QR Code, com a taxa do Pix. */
  async iniciar(
    request: FastifyRequest<{ Body: IniciarPagamentoPixDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { venda, subtotal, desconto, cupom_codigo, taxa_pix, total_cobrado, cobranca } =
      await this.pagamentoService.registrarPagamentoPix(
        request.membro.estabelecimentoId,
        request.user.id,
        request.body
      )

    return reply.status(201).send({
      venda_id: venda.id,
      cliente_id: venda.cliente_id,
      subtotal,
      desconto,
      cupom_codigo,
      total_venda: Number(venda.total_venda),
      taxa_pix,
      total_cobrado,
      status_pagamento: venda.status_pagamento,
      turno_id: venda.turno_id as string,
      payment_id: cobranca.payment_id,
      qr_code: cobranca.qr_code,
      qr_code_imagem: cobranca.qr_code_imagem,
      expira_em: cobranca.expira_em,
      itens: venda.itens.map((item) => ({
        produto_id: item.produto_id,
        produto_nome: item.produto.nome,
        quantidade: Number(item.quantidade),
        preco_unitario: Number(item.preco_unitario),
        subtotal: Number(item.subtotal),
      })),
      criada_em: venda.criada_em,
    })
  }

  /** Polling do status. Consolida a venda assim que o provedor confirma. */
  async consultarStatus(
    request: FastifyRequest<{ Params: PaymentIdParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { venda, status } = await this.pagamentoService.consultarPix(
      request.membro.estabelecimentoId,
      request.params.payment_id
    )

    return reply.status(200).send(toStatusCobrancaResponse(status, venda))
  }

  /** SOMENTE DESENVOLVIMENTO — ver o aviso em routes.ts. */
  async simularPagamento(
    request: FastifyRequest<{ Params: PaymentIdParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { venda, status } = await this.pagamentoService.simularPix(
      request.membro.estabelecimentoId,
      request.params.payment_id
    )

    return reply.status(200).send(toStatusCobrancaResponse(status, venda))
  }
}
