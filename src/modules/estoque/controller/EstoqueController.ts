import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toAlertaResponse,
  toMovimentacaoResponse,
  type CreateMovimentacaoDTO,
  type ListMovimentacoesQuery,
} from "../dto/estoque.dto"
import { EstoqueService } from "../service/EstoqueService"

// O body/query já chegam validados pelo schema declarado na rota — por isso
// não há `schema.parse()` aqui (mesmo padrão do ProdutoController).
export class EstoqueController {
  constructor(private estoqueService: EstoqueService) {}

  /** RF12.1/RF13.2 */
  async registrarMovimentacao(
    request: FastifyRequest<{ Body: CreateMovimentacaoDTO }>,
    reply: FastifyReply
  ) {
    // `request.membro` não carrega o userId, por isso o responsável pela
    // movimentação (RN05) vem do `request.user` populado pelo requireAuth.
    if (!request.membro || !request.user) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const movimentacao = await this.estoqueService.registrarMovimentacao(
      request.membro.estabelecimentoId,
      request.user.id,
      request.membro.role,
      request.body
    )

    return reply.status(201).send(toMovimentacaoResponse(movimentacao))
  }

  /** RF15.4 */
  async listMovimentacoes(
    request: FastifyRequest<{ Querystring: ListMovimentacoesQuery }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const resultado = await this.estoqueService.listMovimentacoes(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.query
    )

    return reply.status(200).send({
      ...resultado,
      data: resultado.data.map(toMovimentacaoResponse),
    })
  }

  /** RF16.1/RF17.2 */
  async listAlertas(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produtos = await this.estoqueService.listAlertas(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(produtos.map(toAlertaResponse))
  }
}
