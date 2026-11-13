import type { Role } from "../../../../generated/prisma/client.js"
import { ForbiddenError, NotFoundError } from "@/shared/errors"
import type { IProdutoRepository } from "@/modules/produto/repository/IProdutoRepository"
import type { CreateMovimentacaoDTO, ListMovimentacoesQuery } from "../dto/estoque.dto"
import type { IEstoqueRepository } from "../repository/IEstoqueRepository"
import type { NotificacaoService } from "@/modules/notificacao/service/NotificacaoService"

export class EstoqueService {
  constructor(
    private estoqueRepository: IEstoqueRepository,
    private produtoRepository: IProdutoRepository,
    /** Sininho do painel. Opcional: só as rotas de produção injetam. */
    private notificacaoService?: NotificacaoService
  ) {}

  /** Mesma regra dos módulos Produto/Categoria: Caixa é estrito ao PDV. */
  private garantirAcesso(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem gerenciar o estoque.",
        "ROLE_CANNOT_MANAGE_ESTOQUE"
      )
    }
  }

  /** RF12.1/RF13.2 + RN04/RN05 */
  async registrarMovimentacao(
    estabelecimentoId: string,
    usuarioId: string,
    role: Role,
    data: CreateMovimentacaoDTO
  ) {
    this.garantirAcesso(role)

    // Reusa o repositório de Produto (que já filtra loja + soft delete) em vez
    // de duplicar a regra aqui — mesmo motivo de ProdutoService injetar
    // IEstabelecimentoRepository. Produto inativo é permitido de propósito: um
    // item fora de venda ainda precisa de baixa por PERDA/DESCARTE.
    const produto = await this.produtoRepository.findByIdAndEstabelecimento(
      data.produto_id,
      estabelecimentoId
    )

    if (!produto) {
      throw new NotFoundError("Produto não encontrado.", "PRODUTO_NAO_ENCONTRADO")
    }

    const movimentacao = await this.estoqueRepository.registrarMovimentacao({
      estabelecimento_id: estabelecimentoId,
      produto_id: data.produto_id,
      usuario_id: usuarioId,
      quantidade: data.quantidade,
      tipo: data.tipo,
      motivo: data.motivo,
      observacao: data.observacao,
    })

    // Saída manual (perda, descarte...) também pode cruzar o mínimo. Nunca lança.
    if (data.tipo === "SAIDA") {
      await this.notificacaoService?.aposSaidaDeEstoque(estabelecimentoId, [
        { produto_id: data.produto_id, quantidade: data.quantidade },
      ])
    }

    return movimentacao
  }

  /** RF15.4 */
  async listMovimentacoes(
    estabelecimentoId: string,
    role: Role,
    query: ListMovimentacoesQuery
  ) {
    this.garantirAcesso(role)

    const { data, total } = await this.estoqueRepository.findManyByEstabelecimento(
      estabelecimentoId,
      { produto_id: query.produto_id, page: query.page, limit: query.limit }
    )

    return { data, total, page: query.page, limit: query.limit }
  }

  /** RF16.1/RF17.2 */
  async listAlertas(estabelecimentoId: string, role: Role) {
    this.garantirAcesso(role)

    return this.estoqueRepository.findProdutosComEstoqueBaixo(estabelecimentoId)
  }
}
