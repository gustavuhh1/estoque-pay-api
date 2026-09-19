import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import {
  toCategoriaResponse,
  type CategoriaParams,
  type CreateCategoriaDTO,
  type ProdutoIdsDTO,
  type UpdateCategoriaDTO,
} from "../dto/categoria.dto"
import { CategoriaService } from "../service/CategoriaService"

// O body/params já chegam validados pelo schema declarado na rota — por isso
// não há `schema.parse()` aqui (mesmo padrão do ProdutoController).
export class CategoriaController {
  constructor(private categoriaService: CategoriaService) {}

  /** RF07.1 */
  async create(
    request: FastifyRequest<{ Body: CreateCategoriaDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const categoria = await this.categoriaService.create(
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(201).send(toCategoriaResponse(categoria))
  }

  /** RF08.2 */
  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const categorias = await this.categoriaService.list(
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(200).send(categorias.map(toCategoriaResponse))
  }

  /** RF09.3 / RF11.5 */
  async update(
    request: FastifyRequest<{ Params: CategoriaParams; Body: UpdateCategoriaDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const categoria = await this.categoriaService.update(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body
    )

    return reply.status(200).send(toCategoriaResponse(categoria))
  }

  /** RF11.5: adiciona produtos ao vínculo N:N (incremental — connect). */
  async addProdutos(
    request: FastifyRequest<{ Params: CategoriaParams; Body: ProdutoIdsDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const categoria = await this.categoriaService.addProdutos(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body.produto_ids
    )

    return reply.status(200).send(toCategoriaResponse(categoria))
  }

  /** RF11.5: remove produtos do vínculo N:N (incremental — disconnect). */
  async removeProdutos(
    request: FastifyRequest<{ Params: CategoriaParams; Body: ProdutoIdsDTO }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    const categoria = await this.categoriaService.removeProdutos(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role,
      request.body.produto_ids
    )

    return reply.status(200).send(toCategoriaResponse(categoria))
  }

  /** RF10.4 */
  async delete(
    request: FastifyRequest<{ Params: CategoriaParams }>,
    reply: FastifyReply
  ) {
    if (!request.membro) {
      throw new UnauthorizedError("Autenticação necessária.")
    }

    await this.categoriaService.delete(
      request.params.id,
      request.membro.estabelecimentoId,
      request.membro.role
    )

    return reply.status(204).send()
  }
}
