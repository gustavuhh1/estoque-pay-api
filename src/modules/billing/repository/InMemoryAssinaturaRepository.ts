import type { Assinatura } from "../../../../generated/prisma/client.js"
import type { IAssinaturaRepository, SalvarAssinaturaParams } from "./IAssinaturaRepository"
import type { InMemoryPlanoRepository } from "./InMemoryPlanoRepository"

/**
 * Dublê para os testes unitários. Escreve no MESMO mapa que o
 * `InMemoryPlanoRepository` lê, para o teste enxergar o efeito da escrita pelo
 * lado do plano efetivo.
 */
export class InMemoryAssinaturaRepository implements IAssinaturaRepository {
  /** Lojas cuja NFC-e foi desligada pela assinatura (RN03). */
  public nfceDesligadas: string[] = []
  public salvamentos = 0

  constructor(private planoRepository: InMemoryPlanoRepository) {}

  async salvar(params: SalvarAssinaturaParams): Promise<Assinatura> {
    const existente = this.planoRepository.assinaturas.get(params.estabelecimento_id)

    const assinatura: Assinatura = {
      id: existente?.id ?? `assinatura-${params.estabelecimento_id}`,
      estabelecimento_id: params.estabelecimento_id,
      abacatepay_sub_id: params.abacatepay_sub_id,
      abacatepay_customer_id: params.abacatepay_customer_id,
      metodo_pagamento_id: existente?.metodo_pagamento_id ?? null,
      status: params.status,
      tipo_plano: params.tipo_plano,
      trial_expira_em: params.trial_expira_em,
      periodo_atual_fim: params.periodo_atual_fim,
      criado_em: existente?.criado_em ?? new Date(),
      atualizado_em: new Date(),
    }

    this.planoRepository.assinaturas.set(params.estabelecimento_id, assinatura)
    this.salvamentos++

    if (params.desligar_nfce) {
      this.nfceDesligadas.push(params.estabelecimento_id)
    }

    return assinatura
  }
}
