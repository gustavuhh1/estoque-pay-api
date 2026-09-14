import { Prisma, type Role } from "../../../../generated/prisma/client.js"
import { EanGtinAlreadyInUseError, ForbiddenError, NotFoundError } from "@/shared/errors"
import type { IEstabelecimentoRepository } from "@/modules/estabelecimento/repository/IEstabelecimentoRepository"
import type { CreateProdutoDTO, UpdateProdutoDTO } from "../dto/produto.dto"
import type { IProdutoRepository } from "../repository/IProdutoRepository"

export class ProdutoService {
  constructor(
    private produtoRepository: IProdutoRepository,
    private estabelecimentoRepository: IEstabelecimentoRepository
  ) {}

  /**
   * RN04/05: Caixa tem acesso estrito ao PDV — gestão de catálogo (criar,
   * listar, editar, excluir, inativar, reativar) é só de Gestor/Owner/Admin.
   * A futura busca de produto no PDV (Fase 3) é uma rota própria, não esta.
   */
  private garantirAcesso(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem gerenciar produtos.",
        "ROLE_CANNOT_MANAGE_PRODUCTS"
      )
    }
  }

  /** RN09/RN09.1: true = este save precisa forçar `ativo = false`. */
  private async precisaForcarInativo(
    estabelecimentoId: string,
    ncm?: string | null,
    cfop?: string | null
  ): Promise<boolean> {
    const estabelecimento =
      await this.estabelecimentoRepository.findById(estabelecimentoId)

    if (!estabelecimento) {
      throw new NotFoundError("Estabelecimento não encontrado.")
    }

    return estabelecimento.emite_nfce && (!ncm || !cfop)
  }

  /** RF01.1 + RN09.1 (fallback de segurança, nunca bloqueia o save). */
  async create(estabelecimentoId: string, role: Role, data: CreateProdutoDTO) {
    this.garantirAcesso(role)

    if (
      data.ean_gtin &&
      (await this.produtoRepository.existsEanGtin(estabelecimentoId, data.ean_gtin))
    ) {
      throw new EanGtinAlreadyInUseError()
    }

    const forcarInativo = await this.precisaForcarInativo(
      estabelecimentoId,
      data.ncm,
      data.cfop
    )

    try {
      return await this.produtoRepository.create({
        ...data,
        estabelecimento_id: estabelecimentoId,
        ativo: !forcarInativo
      })
    } catch (error) {
      // Corrida: outro request pode ter cadastrado o mesmo ean_gtin entre o
      // pré-check e o insert. Mesmo padrão do CNPJ em EstabelecimentoService.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new EanGtinAlreadyInUseError()
      }

      throw error
    }
  }

  /** RF02.2 */
  async list(estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    return this.produtoRepository.findManyByEstabelecimento(estabelecimentoId)
  }

  /** RF03.3 + RN09.1 (o save também vale pra edição, não só criação). */
  async update(
    id: string,
    estabelecimentoId: string,
    role: Role,
    data: UpdateProdutoDTO
  ) {
    this.garantirAcesso(role)

    const produto = await this.produtoRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!produto) {
      throw new NotFoundError("Produto não encontrado.")
    }

    if (
      data.ean_gtin &&
      (await this.produtoRepository.existsEanGtin(estabelecimentoId, data.ean_gtin, id))
    ) {
      throw new EanGtinAlreadyInUseError()
    }

    const ncmFinal = data.ncm !== undefined ? data.ncm : produto.ncm
    const cfopFinal = data.cfop !== undefined ? data.cfop : produto.cfop
    const forcarInativo = await this.precisaForcarInativo(
      estabelecimentoId,
      ncmFinal,
      cfopFinal
    )

    try {
      // RN09.1: só sobrescreve ativo para false quando necessário — nunca
      // reativa sozinho aqui (reativar é sempre um ato explícito, RF06.6).
      return await this.produtoRepository.update(id, {
        ...data,
        ...(forcarInativo && { ativo: false })
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new EanGtinAlreadyInUseError()
      }

      throw error
    }
  }

  /**
   * RF04.4: exclusão permanente quando o produto nunca foi vendido. Se já
   * tem venda no histórico, vira soft delete invisível (ver IProdutoRepository)
   * pra não perder o histórico financeiro — decisão confirmada com o usuário.
   */
  async delete(id: string, estabelecimentoId: string, role: Role): Promise<void> {
    this.garantirAcesso(role)

    const produto = await this.produtoRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!produto) {
      throw new NotFoundError("Produto não encontrado.")
    }

    if (await this.produtoRepository.possuiItensDeVenda(id)) {
      await this.produtoRepository.softDelete(id)
      return
    }

    await this.produtoRepository.hardDelete(id)
  }

  /** RF05.5: sempre permitido, sem trava fiscal (só reativar é bloqueável). */
  async inativar(id: string, estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    const produto = await this.produtoRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!produto) {
      throw new NotFoundError("Produto não encontrado.")
    }

    return this.produtoRepository.update(id, { ativo: false })
  }

  /** RF06.6 + RN09.2 (trava de reativação — bloqueia, diferente do RN09.1). */
  async reativar(id: string, estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    const produto = await this.produtoRepository.findByIdAndEstabelecimento(
      id,
      estabelecimentoId
    )

    if (!produto) {
      throw new NotFoundError("Produto não encontrado.")
    }

    const estabelecimento =
      await this.estabelecimentoRepository.findById(estabelecimentoId)

    if (!estabelecimento) {
      throw new NotFoundError("Estabelecimento não encontrado.")
    }

    if (estabelecimento.emite_nfce && (!produto.ncm || !produto.cfop)) {
      throw new ForbiddenError(
        "Não é possível reativar: produto sem NCM/CFOP com a emissão de NFC-e ativada nesta loja.",
        "PRODUTO_SEM_CONFORMIDADE_FISCAL"
      )
    }

    return this.produtoRepository.update(id, { ativo: true })
  }
}
