import { describe, it, expect, beforeEach } from "vitest"
import type { Assinatura, StatusAssinatura } from "../../../../generated/prisma/client.js"
import { InMemoryPlanoRepository } from "@/modules/billing/repository/InMemoryPlanoRepository"
import { PlanoService } from "@/modules/billing/service/PlanoService"
import { NfceSimuladaEmissor } from "../emissor/NfceSimuladaEmissor"
import { AVISO_SIMULACAO } from "../espelho"
import { InMemoryNfceRepository } from "../repository/InMemoryNfceRepository"
import type { VendaParaNota } from "../repository/INfceRepository"
import { NfceService } from "../service/NfceService"

const LOJA = "loja-1"

function assinatura(status: StatusAssinatura): Assinatura {
  return {
    id: "a1",
    estabelecimento_id: LOJA,
    abacatepay_sub_id: null,
    abacatepay_customer_id: null,
    metodo_pagamento_id: null,
    status,
    tipo_plano: "MENSAL",
    trial_expira_em: null,
    periodo_atual_fim: null,
    criado_em: new Date(),
    atualizado_em: new Date(),
  }
}

const decimal = (n: number) => ({ toNumber: () => n })

function venda(extra: Partial<VendaParaNota> = {}): VendaParaNota {
  return {
    id: "venda-1",
    estabelecimento_id: LOJA,
    status_pagamento: "PAGO",
    metodo_pagamento: "DINHEIRO",
    total_venda: decimal(24.5),
    taxa_split: null,
    pago_em: new Date("2026-10-29T15:30:00.000Z"),
    nfe_numero: null,
    itens: [
      {
        quantidade: 0.5 as never,
        preco_unitario: 40 as never,
        subtotal: 20 as never,
        produto: { nome: "Queijo Minas" },
      },
      {
        quantidade: 3 as never,
        preco_unitario: 1.5 as never,
        subtotal: 4.5 as never,
        produto: { nome: "Pão" },
      },
    ],
    cliente: null,
    estabelecimento: { nome: "Mercearia do Zé", cnpj: "11222333000181", ie: "123", emite_nfce: true },
    ...extra,
  }
}

describe("NfceService — NFC-e simulada (#81 — D3)", () => {
  let repo: InMemoryNfceRepository
  let planoRepo: InMemoryPlanoRepository
  let sut: NfceService

  beforeEach(() => {
    repo = new InMemoryNfceRepository()
    planoRepo = new InMemoryPlanoRepository()
    planoRepo.assinaturas.set(LOJA, assinatura("ACTIVE"))
    sut = new NfceService(repo, new PlanoService(planoRepo), new NfceSimuladaEmissor())
  })

  describe("emissão automática após o pagamento", () => {
    it("venda paga, Switch ligado e Premium: gera e guarda o espelho", async () => {
      repo.vendas.set("venda-1", venda())

      await sut.emitirAposPagamento("venda-1")

      const nota = await sut.consultar("venda-1", LOJA)
      expect(nota.numero).toBe(1)
      expect(nota.status).toBe("AUTORIZADA")
      expect(nota.espelho).toMatchObject({
        simulada: true,
        aviso: AVISO_SIMULACAO,
        venda_id: "venda-1",
        estabelecimento: { nome: "Mercearia do Zé", cnpj: "11222333000181", ie: "123" },
        forma_pagamento: "DINHEIRO",
        subtotal_itens: 24.5,
        total_venda: 24.5,
        total_cobrado: 24.5,
        taxa_pix: null,
        desconto: 0,
      })
      expect(nota.espelho.itens).toEqual([
        { nome: "Queijo Minas", quantidade: 0.5, preco_unitario: 40, total: 20 },
        { nome: "Pão", quantidade: 3, preco_unitario: 1.5, total: 4.5 },
      ])
    })

    it("TAXA (D1): venda Pix traz a linha de R$ 0,80 e o total cobrado = itens + taxa", async () => {
      repo.vendas.set(
        "venda-1",
        venda({ metodo_pagamento: "PIX_ABACATEPAY", taxa_split: decimal(0.8) })
      )

      await sut.emitirAposPagamento("venda-1")

      const { espelho } = await sut.consultar("venda-1", LOJA)
      expect(espelho.forma_pagamento).toBe("PIX")
      expect(espelho.taxa_pix).toBe(0.8)
      expect(espelho.total_venda).toBe(24.5)
      expect(espelho.total_cobrado).toBe(25.3)
    })

    it("dinheiro e cartão NÃO têm taxa, mesmo se a coluna estivesse preenchida", async () => {
      for (const metodo of ["DINHEIRO", "DEBITO", "CREDITO"] as const) {
        repo.vendas.set(
          `venda-${metodo}`,
          venda({ id: `venda-${metodo}`, metodo_pagamento: metodo, taxa_split: decimal(0.8) })
        )
        await sut.emitirAposPagamento(`venda-${metodo}`)

        const { espelho } = await sut.consultar(`venda-${metodo}`, LOJA)
        expect(espelho.taxa_pix).toBeNull()
        expect(espelho.total_cobrado).toBe(24.5)
      }
    })

    it("não propaga erro de float nos centavos (10.07 + 0.8 = 10.87)", async () => {
      repo.vendas.set(
        "venda-1",
        venda({
          metodo_pagamento: "PIX_ABACATEPAY",
          taxa_split: decimal(0.8),
          total_venda: decimal(10.07),
          itens: [
            { quantidade: 1 as never, preco_unitario: 10.07 as never, subtotal: 10.07 as never, produto: { nome: "X" } },
          ],
        })
      )

      await sut.emitirAposPagamento("venda-1")

      expect((await sut.consultar("venda-1", LOJA)).espelho.total_cobrado).toBe(10.87)
    })

    it("cupom: o desconto é a diferença entre os itens e o total da venda", async () => {
      repo.vendas.set("venda-1", venda({ total_venda: decimal(19.5) }))

      await sut.emitirAposPagamento("venda-1")

      const { espelho } = await sut.consultar("venda-1", LOJA)
      expect(espelho.subtotal_itens).toBe(24.5)
      expect(espelho.desconto).toBe(5)
      expect(espelho.total_venda).toBe(19.5)
    })

    it("RN03 da Fase 4: sem cliente, Consumidor Não Identificado", async () => {
      repo.vendas.set("venda-1", venda())

      await sut.emitirAposPagamento("venda-1")

      expect((await sut.consultar("venda-1", LOJA)).espelho.consumidor).toEqual({
        identificado: false,
        nome: null,
        cpf: null,
      })
    })

    it("com cliente, leva o nome e o CPF", async () => {
      repo.vendas.set("venda-1", venda({ cliente: { nome: "Maria Souza", cpf: "52998224725" } }))

      await sut.emitirAposPagamento("venda-1")

      expect((await sut.consultar("venda-1", LOJA)).espelho.consumidor).toEqual({
        identificado: true,
        nome: "Maria Souza",
        cpf: "52998224725",
      })
    })

    it("a chave de acesso é fictícia", async () => {
      repo.vendas.set("venda-1", venda())

      await sut.emitirAposPagamento("venda-1")

      expect((await sut.consultar("venda-1", LOJA)).espelho.chave_de_acesso).toMatch(/^SIMULADO\d{36}$/)
    })
  })

  describe("quando NÃO gera", () => {
    it("Switch Fiscal desligado", async () => {
      repo.vendas.set(
        "venda-1",
        venda({ estabelecimento: { nome: "L", cnpj: "1", ie: null, emite_nfce: false } })
      )

      await sut.emitirAposPagamento("venda-1")

      expect(repo.notas.size).toBe(0)
    })

    it.each([undefined, "PAST_DUE", "CANCELED"] as const)(
      "plano Free (assinatura %s), mesmo com o Switch ligado",
      async (status) => {
        planoRepo.assinaturas.clear()
        if (status) planoRepo.assinaturas.set(LOJA, assinatura(status))
        repo.vendas.set("venda-1", venda())

        await sut.emitirAposPagamento("venda-1")

        expect(repo.notas.size).toBe(0)
      }
    )

    it.each(["PENDENTE", "CANCELADO"] as const)("venda %s", async (status) => {
      repo.vendas.set("venda-1", venda({ status_pagamento: status }))

      await sut.emitirAposPagamento("venda-1")

      expect(repo.notas.size).toBe(0)
    })

    it("venda inexistente não lança", async () => {
      await expect(sut.emitirAposPagamento("nao-existe")).resolves.toBeUndefined()
    })

    it("trial (TRIALING) conta como Premium", async () => {
      planoRepo.assinaturas.set(LOJA, assinatura("TRIALING"))
      repo.vendas.set("venda-1", venda())

      await sut.emitirAposPagamento("venda-1")

      expect(repo.notas.size).toBe(1)
    })
  })

  describe("numeração e idempotência", () => {
    it("é sequencial por loja", async () => {
      repo.vendas.set("a", venda({ id: "a" }))
      repo.vendas.set("b", venda({ id: "b" }))
      repo.vendas.set("c", venda({ id: "c" }))

      await sut.emitirAposPagamento("a")
      await sut.emitirAposPagamento("b")
      await sut.emitirAposPagamento("c")

      expect((await sut.consultar("a", LOJA)).numero).toBe(1)
      expect((await sut.consultar("b", LOJA)).numero).toBe(2)
      expect((await sut.consultar("c", LOJA)).numero).toBe(3)
    })

    it("cada loja tem a sua numeração", async () => {
      planoRepo.assinaturas.set("loja-2", { ...assinatura("ACTIVE"), estabelecimento_id: "loja-2" })
      repo.vendas.set("a", venda({ id: "a" }))
      repo.vendas.set("b", venda({ id: "b", estabelecimento_id: "loja-2" }))

      await sut.emitirAposPagamento("a")
      await sut.emitirAposPagamento("b")

      expect((await sut.consultar("a", LOJA)).numero).toBe(1)
      expect((await sut.consultar("b", "loja-2")).numero).toBe(1)
    })

    it("emitir de novo a mesma venda não duplica nem gasta número", async () => {
      repo.vendas.set("a", venda({ id: "a" }))
      repo.vendas.set("b", venda({ id: "b" }))

      await sut.emitirAposPagamento("a")
      await sut.emitirAposPagamento("a")
      await sut.emitirAposPagamento("a")
      await sut.emitirAposPagamento("b")

      expect(repo.notas.size).toBe(2)
      expect((await sut.consultar("b", LOJA)).numero).toBe(2)
    })
  })

  describe("falha ao gerar (nunca derruba a venda)", () => {
    it("emitirAposPagamento engole o erro e o deixa registrado como ERRO", async () => {
      repo.vendas.set("venda-1", venda())
      repo.falharNaGeracao = new Error("disco cheio")

      await expect(sut.emitirAposPagamento("venda-1")).resolves.toBeUndefined()

      expect(repo.notas.size).toBe(0)
      expect(repo.erros.get("venda-1")).toBe("disco cheio")
    })

    it("o número não é gasto na falha: a próxima nota continua a sequência sem buraco", async () => {
      repo.vendas.set("a", venda({ id: "a" }))
      repo.vendas.set("b", venda({ id: "b" }))
      repo.falharNaGeracao = new Error("falha transitória")
      await sut.emitirAposPagamento("a")
      repo.falharNaGeracao = null

      await sut.emitirAposPagamento("b")

      expect((await sut.consultar("b", LOJA)).numero).toBe(1)
    })

    it("a reemissão manual recupera a venda que ficou em ERRO", async () => {
      repo.vendas.set("venda-1", venda())
      repo.falharNaGeracao = new Error("falha transitória")
      await sut.emitirAposPagamento("venda-1")
      repo.falharNaGeracao = null

      const { criada, nota } = await sut.emitirManual("venda-1", LOJA, "OWNER")

      expect(criada).toBe(true)
      expect(nota.numero).toBe(1)
      expect(repo.erros.has("venda-1")).toBe(false)
    })
  })

  describe("emitirManual", () => {
    it("é idempotente: se a nota existe, devolve a mesma sem criar outra", async () => {
      repo.vendas.set("venda-1", venda())
      const primeira = await sut.emitirManual("venda-1", LOJA, "MANAGER")
      const segunda = await sut.emitirManual("venda-1", LOJA, "MANAGER")

      expect(primeira.criada).toBe(true)
      expect(segunda.criada).toBe(false)
      expect(segunda.nota.numero).toBe(primeira.nota.numero)
      expect(repo.notas.size).toBe(1)
    })

    it("o Caixa não reemite", async () => {
      repo.vendas.set("venda-1", venda())

      await expect(sut.emitirManual("venda-1", LOJA, "CASHIER")).rejects.toMatchObject({
        statusCode: 403,
        code: "ROLE_CANNOT_EMIT_NFCE",
      })
    })

    it("venda de outra loja é 404", async () => {
      repo.vendas.set("venda-1", venda())

      await expect(sut.emitirManual("venda-1", "outra-loja", "OWNER")).rejects.toMatchObject({
        statusCode: 404,
        code: "VENDA_NAO_ENCONTRADA",
      })
    })

    it.each([
      ["venda pendente", venda({ status_pagamento: "PENDENTE" }), "VENDA_NAO_PAGA"],
      [
        "Switch desligado",
        venda({ estabelecimento: { nome: "L", cnpj: "1", ie: null, emite_nfce: false } }),
        "SWITCH_DESLIGADO",
      ],
    ] as const)("%s: 409 NFCE_NAO_ELEGIVEL com o motivo", async (_nome, v, motivo) => {
      repo.vendas.set("venda-1", v)

      await expect(sut.emitirManual("venda-1", LOJA, "OWNER")).rejects.toMatchObject({
        statusCode: 409,
        code: "NFCE_NAO_ELEGIVEL",
        details: { motivo },
      })
    })

    it("plano Free: 409 com motivo PLANO_FREE", async () => {
      planoRepo.assinaturas.clear()
      repo.vendas.set("venda-1", venda())

      await expect(sut.emitirManual("venda-1", LOJA, "OWNER")).rejects.toMatchObject({
        code: "NFCE_NAO_ELEGIVEL",
        details: { motivo: "PLANO_FREE" },
      })
    })

    it("nota já emitida sobrevive ao rebaixamento: o histórico não some", async () => {
      repo.vendas.set("venda-1", venda())
      await sut.emitirAposPagamento("venda-1")
      planoRepo.assinaturas.clear()

      const { criada, nota } = await sut.emitirManual("venda-1", LOJA, "OWNER")

      expect(criada).toBe(false)
      expect(nota.numero).toBe(1)
    })
  })

  describe("consulta, listagem e impressão", () => {
    it("consultar nota de outra loja é 404", async () => {
      repo.vendas.set("venda-1", venda())
      await sut.emitirAposPagamento("venda-1")

      await expect(sut.consultar("venda-1", "outra-loja")).rejects.toMatchObject({
        statusCode: 404,
        code: "NFCE_NAO_ENCONTRADA",
      })
    })

    it("venda sem nota é 404", async () => {
      repo.vendas.set("venda-1", venda())

      await expect(sut.consultar("venda-1", LOJA)).rejects.toMatchObject({
        code: "NFCE_NAO_ENCONTRADA",
      })
    })

    it("lista da mais nova para a mais antiga, paginada, só da loja", async () => {
      planoRepo.assinaturas.set("loja-2", { ...assinatura("ACTIVE"), estabelecimento_id: "loja-2" })
      for (const id of ["a", "b", "c"]) repo.vendas.set(id, venda({ id }))
      repo.vendas.set("z", venda({ id: "z", estabelecimento_id: "loja-2" }))
      for (const id of ["a", "b", "c", "z"]) await sut.emitirAposPagamento(id)

      const pagina1 = await sut.listar(LOJA, 1, 2)
      const pagina2 = await sut.listar(LOJA, 2, 2)

      expect(pagina1.total).toBe(3)
      expect(pagina1.data.map((n) => n.numero)).toEqual([3, 2])
      expect(pagina2.data.map((n) => n.numero)).toEqual([1])
    })

    it("imprimir devolve o HTML com o aviso de simulação", async () => {
      repo.vendas.set("venda-1", venda())
      await sut.emitirAposPagamento("venda-1")

      const html = await sut.imprimir("venda-1", LOJA)

      expect(html).toContain(AVISO_SIMULACAO)
      expect(html).toContain("Mercearia do Zé")
    })

    it("imprimir nota de outra loja é 404", async () => {
      repo.vendas.set("venda-1", venda())
      await sut.emitirAposPagamento("venda-1")

      await expect(sut.imprimir("venda-1", "outra-loja")).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
