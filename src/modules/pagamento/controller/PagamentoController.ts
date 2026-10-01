import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type { RegistrarPagamentoDTO } from "../dto/pagamento.dto"
import { PagamentoService } from "../service/PagamentoService"

export class PagamentoController {
  constructor(private pagamentoService: PagamentoService) {}

  /** RF02.1/RF02.2 */
  async registrar(
    request: FastifyRequest<{ Body: RegistrarPagamentoDTO }>,
    reply: FastifyReply
  ) {
    // `request.membro` não carrega o userId, por isso o operador do caixa vem
    // do `request.user` populado pelo requireAuth.
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const { venda, valor_pago, troco } =
      await this.pagamentoService.registrarPagamentoManual(
        request.membro.estabelecimentoId,
        request.user.id,
        request.body
      )

    return reply.status(201).send({
      venda_id: venda.id,
      total_venda: Number(venda.total_venda),
      metodo_pagamento: venda.metodo_pagamento,
      valor_pago,
      troco,
      turno_id: venda.turno_id,
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
}
