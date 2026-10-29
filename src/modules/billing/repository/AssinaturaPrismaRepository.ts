import type { PrismaClient } from "../../../../generated/prisma/client.js"
import type { IAssinaturaRepository, SalvarAssinaturaParams } from "./IAssinaturaRepository"

export class AssinaturaPrismaRepository implements IAssinaturaRepository {
  constructor(private prisma: PrismaClient) {}

  async salvar(params: SalvarAssinaturaParams) {
    const dados = {
      abacatepay_sub_id: params.abacatepay_sub_id,
      abacatepay_customer_id: params.abacatepay_customer_id,
      status: params.status,
      tipo_plano: params.tipo_plano,
      trial_expira_em: params.trial_expira_em,
      periodo_atual_fim: params.periodo_atual_fim,
    }

    return this.prisma.$transaction(async (tx) => {
      const assinatura = await tx.assinatura.upsert({
        where: { estabelecimento_id: params.estabelecimento_id },
        create: { estabelecimento_id: params.estabelecimento_id, ...dados },
        update: dados,
      })

      if (params.desligar_nfce) {
        await tx.estabelecimento.update({
          where: { id: params.estabelecimento_id },
          data: { emite_nfce: false },
        })
      }

      return assinatura
    })
  }
}
