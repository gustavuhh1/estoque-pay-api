import type { Estabelecimento, Role } from "../../../../generated/prisma/client.js"
import { ForbiddenError, NfcePreCheckReprovadoError, NotFoundError } from "@/shared/errors"
import { planoEfetivo, type PlanoEfetivo } from "@/shared/utils"
import type { IProdutoRepository } from "@/modules/produto/repository/IProdutoRepository"
import type { PendenciaFiscal } from "../dto/estabelecimento.dto"
import type { IEstabelecimentoRepository } from "../repository/IEstabelecimentoRepository"

/** Teto da amostra de produtos pendentes devolvida ao front. */
const LIMITE_PRODUTOS_PENDENTES = 50

export interface PreCheckFiscal {
  apto: boolean
  plano: PlanoEfetivo
  emite_nfce: boolean
  pendencias: PendenciaFiscal[]
}

/**
 * RN01 e RN01.1 (Fase 4) — issue #59: Pre-check de Conformidade e o Switch
 * Fiscal (`Estabelecimento.emite_nfce`).
 *
 * Ligar exige, ao mesmo tempo: plano Premium (derivado da assinatura, RN00),
 * Certificado A1 com senha, CNPJ/IE preenchidos e nenhum produto ATIVO sem
 * NCM/CFOP. Desligar é sempre permitido — sair da emissão nunca deixa a loja
 * irregular.
 */
export class SwitchFiscalService {
  constructor(
    private estabelecimentoRepository: IEstabelecimentoRepository,
    private produtoRepository: IProdutoRepository
  ) {}

  /**
   * RN04/05: o Switch é ação fiscal crítica, como CNPJ e Certificado A1 — só o
   * dono liga ou desliga (e o ADMIN, que tem acesso total quando vinculado).
   */
  private garantirAcessoSwitch(role: Role) {
    if (role !== "OWNER" && role !== "ADMIN") {
      throw new ForbiddenError(
        "Só o dono da loja pode ligar ou desligar a emissão de NFC-e.",
        "ROLE_CANNOT_MANAGE_NFCE"
      )
    }
  }

  /**
   * Consultar o pre-check é liberado ao Gestor: é ele quem cadastra NCM/CFOP
   * nos produtos, então precisa ver o que falta. Caixa fica de fora (RN04/05).
   */
  private garantirAcessoConsulta(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem consultar a conformidade fiscal da loja.",
        "ROLE_CANNOT_MANAGE_NFCE"
      )
    }
  }

  async preCheck(estabelecimentoId: string, role: Role): Promise<PreCheckFiscal> {
    this.garantirAcessoConsulta(role)

    return this.avaliar(await this.buscarLoja(estabelecimentoId))
  }

  async alterarSwitch(
    estabelecimentoId: string,
    role: Role,
    emiteNfce: boolean
  ): Promise<Estabelecimento> {
    this.garantirAcessoSwitch(role)

    const estabelecimento = await this.buscarLoja(estabelecimentoId)

    if (emiteNfce) {
      const { pendencias } = await this.avaliar(estabelecimento)

      if (pendencias.length > 0) {
        throw new NfcePreCheckReprovadoError(pendencias)
      }
    }

    // Idempotente: ligar o que já está ligado (com o pre-check ainda válido)
    // ou desligar o que já está desligado só devolve o estado atual.
    return this.estabelecimentoRepository.setEmiteNfce(estabelecimentoId, emiteNfce)
  }

  private async buscarLoja(estabelecimentoId: string): Promise<Estabelecimento> {
    const estabelecimento = await this.estabelecimentoRepository.findById(estabelecimentoId)

    if (!estabelecimento) {
      throw new NotFoundError("Estabelecimento não encontrado.")
    }

    return estabelecimento
  }

  /**
   * Coleta TODAS as pendências, não para na primeira: o dono resolve o
   * checklist inteiro de uma vez, em vez de descobrir um problema por tentativa.
   */
  private async avaliar(estabelecimento: Estabelecimento): Promise<PreCheckFiscal> {
    const [statusAssinatura, semFiscal] = await Promise.all([
      this.estabelecimentoRepository.findStatusAssinatura(estabelecimento.id),
      this.produtoRepository.findAtivosSemConformidadeFiscal(
        estabelecimento.id,
        LIMITE_PRODUTOS_PENDENTES
      ),
    ])

    const plano = planoEfetivo(statusAssinatura)
    const pendencias: PendenciaFiscal[] = []

    if (plano !== "PREMIUM") {
      pendencias.push({
        codigo: "PLANO_NAO_PREMIUM",
        mensagem: "A emissão de NFC-e exige o plano Premium ativo.",
      })
    }

    // Sem a senha o certificado não assina nada — tanto faz ter o arquivo.
    if (!estabelecimento.certificado_a1 || !estabelecimento.certificado_a1_senha) {
      pendencias.push({
        codigo: "CERTIFICADO_A1_AUSENTE",
        mensagem: "Faça o upload do Certificado Digital A1 e informe a senha dele.",
      })
    }

    // O CNPJ é obrigatório desde o onboarding; a IE é opcional no cadastro e
    // só passa a ser exigida aqui.
    if (!estabelecimento.ie?.trim()) {
      pendencias.push({
        codigo: "IE_AUSENTE",
        mensagem: "Informe a Inscrição Estadual da loja.",
      })
    }

    if (semFiscal.total > 0) {
      pendencias.push({
        codigo: "PRODUTOS_SEM_NCM_CFOP",
        mensagem: `Há ${semFiscal.total} produto(s) ativo(s) sem NCM ou CFOP. Preencha os dados fiscais ou inative-os.`,
        total_produtos: semFiscal.total,
        produtos: semFiscal.produtos,
      })
    }

    return {
      apto: pendencias.length === 0,
      plano,
      emite_nfce: estabelecimento.emite_nfce,
      pendencias,
    }
  }
}
