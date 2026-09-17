import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toProdutoResponse,
  type CreateProdutoDTO,
  type ProdutoParams,
  type UpdateProdutoDTO,
} from "../dto/produto.dto"
import { ProdutoService } from "../service/ProdutoService"

// O body/params já chegam validados pelo schema declarado na rota — por isso
// não há `schema.parse()` aqui.
export class ProdutoController {
  constructor(private produtoService: ProdutoService) {}

  /** RF01.1 */
  async create(
    request: FastifyRequest<{ Body: CreateProdutoDTO }>,
    reply: FastifyReply
  ) {
    // requireTenant já garantiu vínculo + populou request.membro; isto é só
    // o estreitamento do tipo opcional (e a mesma rede de segurança de sempre).
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produto = await this.produtoService.create(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(201).send(toProdutoResponse(produto))
  }

  /** RF02.2 */
  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produtos = await this.produtoService.list(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(produtos.map(toProdutoResponse))
  }

  /** RF03.3 */
  async update(
    request: FastifyRequest<{ Params: ProdutoParams; Body: UpdateProdutoDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produto = await this.produtoService.update(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(200).send(toProdutoResponse(produto))
  }

  /** RF04.4 */
  async delete(
    request: FastifyRequest<{ Params: ProdutoParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    await this.produtoService.delete(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(204).send()
  }

  /** RF05.5 */
  async inativar(
    request: FastifyRequest<{ Params: ProdutoParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produto = await this.produtoService.inativar(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(toProdutoResponse(produto))
  }

  /** RF06.6 */
  async reativar(
    request: FastifyRequest<{ Params: ProdutoParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const produto = await this.produtoService.reativar(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(toProdutoResponse(produto))
  }
}
