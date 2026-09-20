import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toProdutoBuscaResponse,
  type BuscarProdutoQuery,
  type CalcularVendaDTO,
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
}
