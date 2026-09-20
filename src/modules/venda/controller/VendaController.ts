import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toProdutoBuscaResponse,
  toVendaResponse,
  type BuscarProdutoQuery,
  type CalcularVendaDTO,
  type VendaIdParams,
} from "../dto/venda.dto"
import { VendaService } from "../service/VendaService"

// O body/query já chegam validados pelo schema declarado na rota — por isso
// não há `schema.parse()` aqui (mesmo padrão do EstoqueController).
export class VendaController {
  constructor(private vendaService: VendaService) {}

  /** RF01.1 */
  async buscarProdutos(
    request: FastifyRequest<{ Querystring: BuscarProdutoQuery }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produtos = await this.vendaService.buscarProdutos(
      request.membro.estabelecimentoId,
      request.query.termo
    )

    return reply.status(200).send(produtos.map(toProdutoBuscaResponse))
  }

  /** RF01.2/RF01.3 + RN01: só calcula, não grava nada. */
  async calcular(
    request: FastifyRequest<{ Body: CalcularVendaDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const carrinho = await this.vendaService.precificarCarrinho(
      request.membro.estabelecimentoId,
      request.body.itens
    )

    return reply.status(200).send(carrinho)
  }

  /** RF05.1/RF05.2 — issue #53 */
  async cancelar(
    request: FastifyRequest<{ Params: VendaIdParams }>,
    reply: FastifyReply
  ) {
    // `request.membro` não carrega o userId, por isso quem cancelou vem do
    // `request.user` populado pelo requireAuth.
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const venda = await this.vendaService.cancelar(
      request.membro.estabelecimentoId,
      request.user.id,
      request.membro.role,
      request.params.venda_id
    )

    return reply.status(200).send(toVendaResponse(venda))
  }
}
