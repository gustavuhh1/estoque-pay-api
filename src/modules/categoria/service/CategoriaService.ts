import { Prisma, type Role } from "../../../../generated/prisma/client.js"
import { CategoriaNomeAlreadyInUseError, ForbiddenError, NotFoundError } from "@/shared/errors"
import type { CreateCategoriaDTO, UpdateCategoriaDTO } from "../dto/categoria.dto"
import type { ICategoriaRepository } from "../repository/ICategoriaRepository"

export class CategoriaService {
  constructor(private categoriaRepository: ICategoriaRepository) {}

  /** Mesma regra do módulo Produto: Caixa é estrito ao PDV, não gerencia catálogo. */
  private garantirAcesso(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem gerenciar categorias.",
        "ROLE_CANNOT_MANAGE_CATEGORIAS"
      )
    }
  }

  /** RF11.5: garante que todo produto_id informado é um produto de verdade desta loja. */
  private async validarProdutoIds(estabelecimentoId: string, produtoIds?: string[]) {
    if (!produtoIds || produtoIds.length === 0) {
      return
    }

    const idsUnicos = [...new Set(produtoIds)]
    const total = await this.categoriaRepository.countProdutosByIds(estabelecimentoId, idsUnicos)

    if (total !== idsUnicos.length) {
      throw new NotFoundError(
        "Um ou mais produtos informados não pertencem a esta loja.",
        "PRODUTO_NAO_ENCONTRADO"
      )
    }
  }

  /** RF07.1 */
  async create(estabelecimentoId: string, role: Role, data: CreateCategoriaDTO) {
    this.garantirAcesso(role)

    if (await this.categoriaRepository.existsNome(estabelecimentoId, data.nome)) {
      throw new CategoriaNomeAlreadyInUseError()
    }

    await this.validarProdutoIds(estabelecimentoId, data.produto_ids)

    try {
      return await this.categoriaRepository.create({
        estabelecimento_id: estabelecimentoId,
        nome: data.nome,
        produto_ids: data.produto_ids,
      })
    } catch (error) {
      // Corrida: mesmo padrão do EAN/GTIN em ProdutoService.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CategoriaNomeAlreadyInUseError()
      }

      throw error
    }
  }

  /** RF08.2 */
  async list(estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    return this.categoriaRepository.findManyByEstabelecimento(estabelecimentoId)
  }

  /** RF09.3 */
  async update(id: string, estabelecimentoId: string, role: Role, data: UpdateCategoriaDTO) {
    this.garantirAcesso(role)

    const categoria = await this.categoriaRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!categoria) {
      throw new NotFoundError("Categoria não encontrada.")
    }

    if (await this.categoriaRepository.existsNome(estabelecimentoId, data.nome, id)) {
      throw new CategoriaNomeAlreadyInUseError()
    }

    try {
      return await this.categoriaRepository.update(id, data)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CategoriaNomeAlreadyInUseError()
      }

      throw error
    }
  }

  /** RF11.5: incremental (connect) — só adiciona os produtos informados, não afeta o resto do vínculo. */
  async addProdutos(id: string, estabelecimentoId: string, role: Role, produtoIds: string[]) {
    this.garantirAcesso(role)

    const categoria = await this.categoriaRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!categoria) {
      throw new NotFoundError("Categoria não encontrada.")
    }

    await this.validarProdutoIds(estabelecimentoId, produtoIds)

    return this.categoriaRepository.addProdutos(id, [...new Set(produtoIds)])
  }

  /**
   * RF11.5 / RN08: incremental (disconnect) — só remove os produtos
   * informados, nunca o Produto em si nem o resto do vínculo.
   */
  async removeProdutos(id: string, estabelecimentoId: string, role: Role, produtoIds: string[]) {
    this.garantirAcesso(role)

    const categoria = await this.categoriaRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!categoria) {
      throw new NotFoundError("Categoria não encontrada.")
    }

    await this.validarProdutoIds(estabelecimentoId, produtoIds)

    return this.categoriaRepository.removeProdutos(id, [...new Set(produtoIds)])
  }

  /** RF10.4 + RN02/RN08: exclusão desimpedida, nunca apaga o produto. */
  async delete(id: string, estabelecimentoId: string, role: Role): Promise<void> {
    this.garantirAcesso(role)

    const categoria = await this.categoriaRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!categoria) {
      throw new NotFoundError("Categoria não encontrada.")
    }

    await this.categoriaRepository.delete(id)
  }
}
