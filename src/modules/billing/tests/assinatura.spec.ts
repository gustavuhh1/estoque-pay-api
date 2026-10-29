import { describe, it, expect, beforeEach } from "vitest"
import { InMemoryEstabelecimentoRepository } from "@/modules/estabelecimento/repository/InMemoryEstabelecimentoRepository"
import { InMemoryAssinaturaGateway } from "../gateway/InMemoryAssinaturaGateway"
import { InMemoryAssinaturaRepository } from "../repository/InMemoryAssinaturaRepository"
import { InMemoryPlanoRepository } from "../repository/InMemoryPlanoRepository"
import { AssinaturaService } from "../service/AssinaturaService"
import { PlanoService } from "../service/PlanoService"

const AGORA = new Date("2026-11-01T12:00:00.000Z")
const EM_7_DIAS = new Date("2026-11-08T12:00:00.000Z")
const SUB = "subs_abc"

describe("AssinaturaService (#65, #66, #67 — D2)", () => {
  let planoRepo: InMemoryPlanoRepository
  let assinaturaRepo: InMemoryAssinaturaRepository
  let estabRepo: InMemoryEstabelecimentoRepository
  let gateway: InMemoryAssinaturaGateway
  let agora: Date
  let sut: AssinaturaService
  let planoService: PlanoService
  let lojaId: string

  beforeEach(async () => {
    planoRepo = new InMemoryPlanoRepository()
    assinaturaRepo = new InMemoryAssinaturaRepository(planoRepo)
    estabRepo = new InMemoryEstabelecimentoRepository()
    gateway = new InMemoryAssinaturaGateway()
    agora = AGORA
    sut = new AssinaturaService(planoRepo, assinaturaRepo, estabRepo, gateway, () => agora)
    planoService = new PlanoService(planoRepo)

    const { estabelecimento } = await estabRepo.createWithOwner({
      ownerId: "owner-1",
      nome: "Mercearia do Zé",
      cnpj: "11222333000181",
    })
    lojaId = estabelecimento.id
  })

  /** O que a AbacatePay "sabe" depois que o cliente pagou o checkout. */
  function provedor(
    extra: Partial<Parameters<InMemoryAssinaturaGateway["registrar"]>[0]> = {}
  ) {
    return gateway.registrar({
      subscription_id: SUB,
      checkout_id: "bill_abc",
      estabelecimento_id: lojaId,
      status: "ACTIVE",
      trial_expira_em: EM_7_DIAS,
      tipo_plano: "MENSAL",
      ...extra,
    })
  }

  describe("iniciar (#65 — RF01.2 / RN04)", () => {
    it("cria o checkout só no cartão e devolve a URL do provedor", async () => {
      const resultado = await sut.iniciar(lojaId, "OWNER", { email: "dono@email.com" }, "MENSAL")

      expect(resultado.checkout_url).toContain(resultado.checkout_id)
      expect(resultado.trial_dias).toBe(7)
      expect(resultado.valor).toBe(30)
      expect(gateway.checkouts).toHaveLength(1)
      expect(gateway.checkouts[0]).toMatchObject({
        estabelecimento_id: lojaId,
        tipo_plano: "MENSAL",
        cliente: { email: "dono@email.com", nome: "Mercearia do Zé", documento: "11222333000181" },
      })
    })

    it("plano anual custa R$ 299,90", async () => {
      const resultado = await sut.iniciar(lojaId, "OWNER", { email: "d@e.com" }, "ANUAL")

      expect(resultado.valor).toBe(299.9)
      expect(resultado.tipo_plano).toBe("ANUAL")
    })

    it("RN04: NÃO grava Assinatura, então a loja segue Free até o cartão ser confirmado", async () => {
      await sut.iniciar(lojaId, "OWNER", { email: "dono@email.com" }, "MENSAL")

      expect(assinaturaRepo.salvamentos).toBe(0)
      expect((await planoService.obterPlano(lojaId)).plano).toBe("FREE")
    })

    it("o Gestor não contrata (RN04/05 da Fase 1)", async () => {
      await expect(
        sut.iniciar(lojaId, "MANAGER", { email: "g@e.com" }, "MENSAL")
      ).rejects.toMatchObject({ statusCode: 403, code: "ROLE_CANNOT_MANAGE_PLANO" })
      expect(gateway.checkouts).toHaveLength(0)
    })

    it("o Caixa não contrata", async () => {
      await expect(
        sut.iniciar(lojaId, "CASHIER", { email: "c@e.com" }, "MENSAL")
      ).rejects.toMatchObject({ code: "ROLE_CANNOT_MANAGE_PLANO" })
    })

    it("o Admin da plataforma contrata", async () => {
      await expect(
        sut.iniciar(lojaId, "ADMIN", { email: "a@e.com" }, "MENSAL")
      ).resolves.toBeDefined()
    })

    it.each(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"] as const)(
      "trial é um só: loja com assinatura %s não inicia outra",
      async (status) => {
        provedor({ status: status === "CANCELED" ? "CANCELLED" : "ACTIVE" })
        await sut.processarEventoWebhook("subscription.completed", [SUB])
        planoRepo.assinaturas.set(lojaId, { ...planoRepo.assinaturas.get(lojaId)!, status })

        await expect(
          sut.iniciar(lojaId, "OWNER", { email: "d@e.com" }, "MENSAL")
        ).rejects.toMatchObject({
          statusCode: 409,
          code: "ASSINATURA_JA_EXISTENTE",
          details: { status_atual: status },
        })
      }
    )

    it("loja inexistente é 404", async () => {
      await expect(
        sut.iniciar("outra-loja", "OWNER", { email: "d@e.com" }, "MENSAL")
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe("processarEventoWebhook — trial e ativação (#65 / #67)", () => {
    it("trial_started: a loja vira TRIALING (Premium) com a data de fim do trial", async () => {
      provedor()

      const resultado = await sut.processarEventoWebhook("subscription.trial_started", [SUB])

      expect(resultado).toEqual({ processado: true })
      const plano = await planoService.obterPlano(lojaId)
      expect(plano.plano).toBe("PREMIUM")
      expect(plano.status).toBe("TRIALING")
      expect(plano.trial_expira_em).toEqual(EM_7_DIAS)
      expect(plano.periodo_atual_fim).toEqual(EM_7_DIAS)
    })

    it("o evento pode trazer o id do checkout (bill_) em vez do da assinatura", async () => {
      provedor()

      const resultado = await sut.processarEventoWebhook("subscription.trial_started", ["bill_abc"])

      expect(resultado.processado).toBe(true)
    })

    it("tenta cada id candidato até achar o que o provedor reconhece", async () => {
      provedor()

      const resultado = await sut.processarEventoWebhook("subscription.completed", [
        "id_que_nao_existe",
        SUB,
      ])

      expect(resultado.processado).toBe(true)
    })

    it("sem trial, a assinatura paga já nasce ACTIVE com o fim do ciclo estimado", async () => {
      provedor({ trial_expira_em: null, tipo_plano: "ANUAL" })

      await sut.processarEventoWebhook("subscription.completed", [SUB])

      const plano = await planoService.obterPlano(lojaId)
      expect(plano.status).toBe("ACTIVE")
      expect(plano.tipo_plano).toBe("ANUAL")
      expect(plano.periodo_atual_fim).toEqual(new Date("2027-11-01T12:00:00.000Z"))
    })

    it("trial que já passou do fim vira ACTIVE (primeira cobrança feita)", async () => {
      provedor({ trial_expira_em: new Date("2026-10-25T12:00:00.000Z") })

      await sut.processarEventoWebhook("subscription.renewed", [SUB])

      expect((await planoService.obterPlano(lojaId)).status).toBe("ACTIVE")
    })

    it("RN04: checkout ainda PENDING (cartão não confirmado) não ativa nada", async () => {
      provedor({ status: "PENDING" })

      const resultado = await sut.processarEventoWebhook("subscription.completed", [SUB])

      expect(resultado.processado).toBe(false)
      expect(assinaturaRepo.salvamentos).toBe(0)
      expect((await planoService.obterPlano(lojaId)).plano).toBe("FREE")
    })

    it("guarda o id da assinatura e do cliente no provedor", async () => {
      provedor({ customer_id: "cust_77" })

      await sut.processarEventoWebhook("subscription.trial_started", [SUB])

      const assinatura = planoRepo.assinaturas.get(lojaId)
      expect(assinatura?.abacatepay_sub_id).toBe(SUB)
      expect(assinatura?.abacatepay_customer_id).toBe("cust_77")
    })
  })

  describe("processarEventoWebhook — idempotência", () => {
    it("o mesmo evento reenviado não escreve de novo", async () => {
      provedor()

      const primeira = await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      const segunda = await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      const terceira = await sut.processarEventoWebhook("subscription.trial_started", [SUB])

      expect(primeira.processado).toBe(true)
      expect(segunda.processado).toBe(false)
      expect(terceira.processado).toBe(false)
      expect(assinaturaRepo.salvamentos).toBe(1)
    })

    it("reenvio de `completed` depois de `trial_started` não muda nada", async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])

      const resultado = await sut.processarEventoWebhook("subscription.completed", [SUB])

      expect(resultado.processado).toBe(false)
    })

    it("reenvio de `renewed` dentro do período vigente não empurra a data", async () => {
      provedor({ trial_expira_em: null })
      await sut.processarEventoWebhook("subscription.completed", [SUB])
      const fim = planoRepo.assinaturas.get(lojaId)?.periodo_atual_fim
      agora = new Date("2026-11-05T12:00:00.000Z")

      const resultado = await sut.processarEventoWebhook("subscription.renewed", [SUB])

      expect(resultado.processado).toBe(false)
      expect(planoRepo.assinaturas.get(lojaId)?.periodo_atual_fim).toEqual(fim)
    })

    it("renovação de verdade (depois do fim do período) avança o ciclo", async () => {
      provedor({ trial_expira_em: null })
      await sut.processarEventoWebhook("subscription.completed", [SUB])
      agora = new Date("2026-12-02T12:00:00.000Z")

      const resultado = await sut.processarEventoWebhook("subscription.renewed", [SUB])

      expect(resultado.processado).toBe(true)
      expect(planoRepo.assinaturas.get(lojaId)?.periodo_atual_fim).toEqual(
        new Date("2027-01-02T12:00:00.000Z")
      )
    })
  })

  describe("processarEventoWebhook — inadimplência e cancelamento (#67 — RN03)", () => {
    beforeEach(async () => {
      provedor({ trial_expira_em: null })
      await sut.processarEventoWebhook("subscription.completed", [SUB])
    })

    it("payment_failed: PAST_DUE, volta aos limites do Free e desliga a NFC-e", async () => {
      const resultado = await sut.processarEventoWebhook("subscription.payment_failed", [SUB])

      expect(resultado.processado).toBe(true)
      const plano = await planoService.obterPlano(lojaId)
      expect(plano.status).toBe("PAST_DUE")
      expect(plano.plano).toBe("FREE")
      expect(assinaturaRepo.nfceDesligadas).toContain(lojaId)
    })

    it("pagamento recuperado (renewed) tira a loja da inadimplência", async () => {
      await sut.processarEventoWebhook("subscription.payment_failed", [SUB])
      agora = new Date("2026-11-02T12:00:00.000Z")

      await sut.processarEventoWebhook("subscription.renewed", [SUB])

      const plano = await planoService.obterPlano(lojaId)
      expect(plano.status).toBe("ACTIVE")
      expect(plano.plano).toBe("PREMIUM")
    })

    it("cancelled: CANCELED, volta ao Free e desliga a NFC-e", async () => {
      gateway.definir(SUB, { status: "CANCELLED" })

      await sut.processarEventoWebhook("subscription.cancelled", [SUB])

      const plano = await planoService.obterPlano(lojaId)
      expect(plano.status).toBe("CANCELED")
      expect(plano.plano).toBe("FREE")
      expect(assinaturaRepo.nfceDesligadas).toContain(lojaId)
    })

    it("o provedor manda: CANCELLED lá vence um `renewed` atrasado", async () => {
      gateway.definir(SUB, { status: "CANCELLED" })

      await sut.processarEventoWebhook("subscription.renewed", [SUB])

      expect((await planoService.obterPlano(lojaId)).status).toBe("CANCELED")
    })

    it("não desliga a NFC-e enquanto a assinatura está de pé", async () => {
      expect(assinaturaRepo.nfceDesligadas).toHaveLength(0)
    })
  })

  describe("processarEventoWebhook — o que NÃO é nosso", () => {
    it("evento que não é de assinatura é ignorado", async () => {
      provedor()

      const resultado = await sut.processarEventoWebhook("subscription.plan_changed", [SUB])

      expect(resultado.processado).toBe(false)
      expect(assinaturaRepo.salvamentos).toBe(0)
    })

    it("assinatura que a AbacatePay não conhece não é erro", async () => {
      const resultado = await sut.processarEventoWebhook("subscription.completed", ["subs_x"])

      expect(resultado).toEqual({ processado: false })
    })

    it("assinatura de outro sistema na mesma conta (sem loja nossa) é ignorada", async () => {
      provedor({ estabelecimento_id: null })

      const resultado = await sut.processarEventoWebhook("subscription.completed", [SUB])

      expect(resultado.processado).toBe(false)
    })

    it("loja que não existe mais é ignorada", async () => {
      provedor({ estabelecimento_id: "loja-apagada" })

      const resultado = await sut.processarEventoWebhook("subscription.completed", [SUB])

      expect(resultado.processado).toBe(false)
    })

    it("segundo checkout pago por loja que já tem assinatura valendo não sobrescreve (trial é um só)", async () => {
      provedor({ trial_expira_em: null })
      await sut.processarEventoWebhook("subscription.completed", [SUB])
      gateway.registrar({
        subscription_id: "subs_duplicada",
        estabelecimento_id: lojaId,
        status: "ACTIVE",
        trial_expira_em: EM_7_DIAS,
      })

      const resultado = await sut.processarEventoWebhook("subscription.trial_started", [
        "subs_duplicada",
      ])

      expect(resultado.processado).toBe(false)
      expect(planoRepo.assinaturas.get(lojaId)?.abacatepay_sub_id).toBe(SUB)
    })

    it("sem id candidato nenhum, não faz nada", async () => {
      expect(await sut.processarEventoWebhook("subscription.completed", [])).toEqual({
        processado: false,
      })
    })
  })

  describe("cancelar (#66)", () => {
    beforeEach(async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])
    })

    it("cancela no provedor, na hora, e a loja volta ao Free sem NFC-e", async () => {
      await sut.cancelar(lojaId, "OWNER")

      expect(gateway.canceladas).toEqual([SUB])
      const plano = await planoService.obterPlano(lojaId)
      expect(plano.status).toBe("CANCELED")
      expect(plano.plano).toBe("FREE")
      expect(assinaturaRepo.nfceDesligadas).toContain(lojaId)
    })

    it("cancelar durante o trial também funciona", async () => {
      expect((await planoService.obterPlano(lojaId)).status).toBe("TRIALING")

      await expect(sut.cancelar(lojaId, "OWNER")).resolves.toMatchObject({ status: "CANCELED" })
    })

    it("cancelar duas vezes é 409 e não chama o provedor de novo", async () => {
      await sut.cancelar(lojaId, "OWNER")

      await expect(sut.cancelar(lojaId, "OWNER")).rejects.toMatchObject({
        statusCode: 409,
        code: "ASSINATURA_JA_CANCELADA",
      })
      expect(gateway.canceladas).toHaveLength(1)
    })

    it("o Gestor não cancela", async () => {
      await expect(sut.cancelar(lojaId, "MANAGER")).rejects.toMatchObject({
        code: "ROLE_CANNOT_MANAGE_PLANO",
      })
      expect(gateway.canceladas).toHaveLength(0)
    })

    it("loja sem assinatura é 404", async () => {
      const { estabelecimento } = await estabRepo.createWithOwner({
        ownerId: "owner-2",
        nome: "Outra",
        cnpj: "11444777000161",
      })

      await expect(sut.cancelar(estabelecimento.id, "OWNER")).rejects.toMatchObject({
        statusCode: 404,
        code: "ASSINATURA_NAO_ENCONTRADA",
      })
    })
  })

  describe("reconciliarTrialVencido (#66 — rede de segurança)", () => {
    it("trial vencido que ainda aparece como TRIALING é conferido no provedor", async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      // O primeiro débito rolou, mas o evento nunca chegou.
      agora = new Date("2026-11-09T12:00:00.000Z")

      await sut.reconciliarTrialVencido(lojaId)

      expect((await planoService.obterPlano(lojaId)).status).toBe("ACTIVE")
    })

    it("trial vencido e assinatura cancelada no provedor: a loja volta ao Free", async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      gateway.definir(SUB, { status: "CANCELLED" })
      agora = new Date("2026-11-09T12:00:00.000Z")

      await sut.reconciliarTrialVencido(lojaId)

      expect((await planoService.obterPlano(lojaId)).plano).toBe("FREE")
    })

    it("trial ainda vigente: nem consulta o provedor", async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      const antes = assinaturaRepo.salvamentos
      agora = new Date("2026-11-03T12:00:00.000Z")

      await sut.reconciliarTrialVencido(lojaId)

      expect(assinaturaRepo.salvamentos).toBe(antes)
    })

    it("loja sem assinatura não faz nada", async () => {
      await expect(sut.reconciliarTrialVencido(lojaId)).resolves.toBeUndefined()
    })

    it("falha do provedor não derruba a consulta", async () => {
      provedor()
      await sut.processarEventoWebhook("subscription.trial_started", [SUB])
      agora = new Date("2026-11-09T12:00:00.000Z")
      gateway.consultarAssinatura = async () => {
        throw new Error("provedor fora do ar")
      }

      await expect(sut.reconciliarTrialVencido(lojaId)).resolves.toBeUndefined()
      expect((await planoService.obterPlano(lojaId)).status).toBe("TRIALING")
    })
  })
})
