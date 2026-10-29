import type { StatusAssinatura, TipoPlano } from "../../../../generated/prisma/client.js"
import { PlanoLimiteExcedidoError, PlanoRecursoIndisponivelError } from "@/shared/errors"
import { planoEfetivo, type PlanoEfetivo } from "@/shared/utils"
import { LIMITES_DO_PLANO, type LimitesDoPlano } from "../planos"
import type { IPlanoRepository } from "../repository/IPlanoRepository"

export interface PlanoDaLoja {
  plano: PlanoEfetivo
  /** null = a loja nunca assinou. */
  status: StatusAssinatura | null
  tipo_plano: TipoPlano | null
  trial_expira_em: Date | null
  periodo_atual_fim: Date | null
  limites: LimitesDoPlano
}

export interface UsoDaLoja {
  produtos_ativos: number
  membros: number
}

/** Campos do CRM que o Free não guarda (RN01: só CPF e Nome). */
export interface CamposCrmOpcionais {
  telefone?: string | null | undefined
  data_nascimento?: Date | null | undefined
  observacao?: string | null | undefined
}

/**
 * RN00 + RN01 (Fase 5) — issues #64 e #68. O HELPER ÚNICO de "Free vs Premium".
 *
 * Todo módulo que depende do plano (produto, equipe, crm, e depois billing e
 * nfce) pergunta aqui, em vez de ler `Assinatura` ou copiar um "50"/"3". O
 * plano em si é derivado de `Assinatura.status` por `planoEfetivo()` (RN00), e
 * os números vêm de `LIMITES_DO_PLANO`.
 *
 * Os `garantir*` só BLOQUEIAM cadastro novo. Nunca mexem no que já existe: loja
 * rebaixada acima do limite continua com tudo (RN03, modo restrito).
 */
export class PlanoService {
  constructor(private planoRepository: IPlanoRepository) {}

  /** RF01.1: o plano efetivo da loja e o que ele permite. */
  async obterPlano(estabelecimentoId: string): Promise<PlanoDaLoja> {
    const assinatura =
      await this.planoRepository.findAssinaturaByEstabelecimento(estabelecimentoId)
    const plano = planoEfetivo(assinatura?.status)

    return {
      plano,
      status: assinatura?.status ?? null,
      tipo_plano: assinatura?.tipo_plano ?? null,
      trial_expira_em: assinatura?.trial_expira_em ?? null,
      periodo_atual_fim: assinatura?.periodo_atual_fim ?? null,
      limites: LIMITES_DO_PLANO[plano],
    }
  }

  async obterUso(estabelecimentoId: string): Promise<UsoDaLoja> {
    const [produtos_ativos, membros] = await Promise.all([
      this.planoRepository.contarProdutosAtivos(estabelecimentoId),
      this.planoRepository.contarMembrosEConvites(estabelecimentoId),
    ])

    return { produtos_ativos, membros }
  }

  /**
   * RN01/RN03: vale para um produto NOVO ativo e para reativar um inativo. Quem
   * cria já inativo (RN09.1) não passa por aqui: não ocupa vaga.
   */
  async garantirPodeAtivarProduto(estabelecimentoId: string): Promise<void> {
    const { limites } = await this.obterPlano(estabelecimentoId)

    if (limites.produtos_ativos === null) return

    const atual = await this.planoRepository.contarProdutosAtivos(estabelecimentoId)

    if (atual >= limites.produtos_ativos) {
      throw new PlanoLimiteExcedidoError("PRODUTOS", limites.produtos_ativos, atual)
    }
  }

  /** RN01/RN03: Owner e convites pendentes contam como membros. */
  async garantirPodeAdicionarMembro(estabelecimentoId: string): Promise<void> {
    const { limites } = await this.obterPlano(estabelecimentoId)

    if (limites.membros === null) return

    const atual = await this.planoRepository.contarMembrosEConvites(estabelecimentoId)

    if (atual >= limites.membros) {
      throw new PlanoLimiteExcedidoError("MEMBROS", limites.membros, atual)
    }
  }

  /**
   * RN01: no Free o cliente só tem CPF e Nome. Preencher telefone, data de
   * nascimento ou observação é bloqueado; `null` (limpar o campo) sempre passa,
   * senão quem foi rebaixado não conseguiria nem apagar o que já tinha.
   */
  async garantirCamposDoCrm(
    estabelecimentoId: string,
    dados: CamposCrmOpcionais
  ): Promise<void> {
    const { limites } = await this.obterPlano(estabelecimentoId)

    if (limites.crm_completo) return

    const bloqueados = (["telefone", "data_nascimento", "observacao"] as const).filter(
      (campo) => dados[campo] !== undefined && dados[campo] !== null
    )

    if (bloqueados.length > 0) {
      throw new PlanoRecursoIndisponivelError("O cadastro completo de clientes", bloqueados)
    }
  }
}
