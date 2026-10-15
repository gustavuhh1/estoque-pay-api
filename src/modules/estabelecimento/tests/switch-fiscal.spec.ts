import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/prisma"
import { ForbiddenError, NfcePreCheckReprovadoError } from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import type { StatusAssinatura } from "../../../../generated/prisma/client.js"
import { EstabelecimentoPrismaRepository } from "../repository/EstabelecimentoPrismaRepository"
import { SwitchFiscalService } from "../service/SwitchFiscalService"

const CNPJ_VALIDO = "11222333000181"

/** Loja que cumpre TODOS os requisitos; cada teste quebra só o que quer provar. */
async function criarLojaApta(
  overrides: Partial<{
    ie: string | null
    certificado_a1: string | null
    certificado_a1_senha: string | null
    statusAssinatura: StatusAssinatura | null
    emite_nfce: boolean
  }> = {}
) {
  const loja = await prisma.estabelecimento.create({
    data: {
      nome: "Loja Fiscal",
      cnpj: CNPJ_VALIDO,
      ie: overrides.ie === undefined ? "123456789" : overrides.ie,
      certificado_a1:
        overrides.certificado_a1 === undefined
          ? "https://storage.example/a1.pfx"
          : overrides.certificado_a1,
      certificado_a1_senha:
        overrides.certificado_a1_senha === undefined
          ? "senha-cifrada"
          : overrides.certificado_a1_senha,
      emite_nfce: overrides.emite_nfce ?? false,
    },
  })

  const status = overrides.statusAssinatura === undefined ? "ACTIVE" : overrides.statusAssinatura
  if (status) {
    await prisma.assinatura.create({ data: { estabelecimento_id: loja.id, status } })
  }

  return loja
}

async function criarProduto(
  estabelecimentoId: string,
  overrides: Partial<{
    nome: string
    ncm: string | null
    cfop: string | null
    ativo: boolean
    deletado_em: Date | null
  }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto",
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 10,
      ncm: overrides.ncm === undefined ? "22021000" : overrides.ncm,
      cfop: overrides.cfop === undefined ? "5102" : overrides.cfop,
      ativo: overrides.ativo ?? true,
      deletado_em: overrides.deletado_em ?? null,
    },
  })
}

/** Os códigos de pendência que o erro carregou — o contrato que o front lê. */
async function codigosDaReprovacao(promessa: Promise<unknown>) {
  const erro = await promessa.then(
    () => {
      throw new Error("Era esperado que o pre-check reprovasse.")
    },
    (error: unknown) => error
  )

  expect(erro).toBeInstanceOf(NfcePreCheckReprovadoError)
  const { pendencias } = (erro as NfcePreCheckReprovadoError).details as {
    pendencias: Array<{ codigo: string }>
  }
  return pendencias.map((pendencia) => pendencia.codigo)
}

describe("SwitchFiscalService (#59 — RN01 / RN01.1)", () => {
  let sut: SwitchFiscalService

  beforeEach(() => {
    sut = new SwitchFiscalService(
      new EstabelecimentoPrismaRepository(prisma),
      new ProdutoPrismaRepository(prisma)
    )
  })

  describe("ligar o switch", () => {
    it("liga quando é Premium, tem Certificado A1, CNPJ/IE e nenhum produto ativo sem NCM/CFOP", async () => {
      const loja = await criarLojaApta()
      await criarProduto(loja.id)

      const resultado = await sut.alterarSwitch(loja.id, "OWNER", true)

      expect(resultado.emite_nfce).toBe(true)
      const noBanco = await prisma.estabelecimento.findUniqueOrThrow({ where: { id: loja.id } })
      expect(noBanco.emite_nfce).toBe(true)
    })

    it("o trial (TRIALING) também conta como Premium", async () => {
      const loja = await criarLojaApta({ statusAssinatura: "TRIALING" })

      const resultado = await sut.alterarSwitch(loja.id, "OWNER", true)

      expect(resultado.emite_nfce).toBe(true)
    })

    it("falha 1: bloqueia se houver 1 produto ativo sem NCM", async () => {
      const loja = await criarLojaApta()
      await criarProduto(loja.id, { nome: "Sem NCM", ncm: null })

      expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
        "PRODUTOS_SEM_NCM_CFOP",
      ])

      const noBanco = await prisma.estabelecimento.findUniqueOrThrow({ where: { id: loja.id } })
      expect(noBanco.emite_nfce).toBe(false)
    })

    it("falha 1: bloqueia se houver produto ativo sem CFOP (ou com CFOP vazio)", async () => {
      const loja = await criarLojaApta()
      await criarProduto(loja.id, { cfop: null })
      await criarProduto(loja.id, { cfop: "" })

      const resultado = await sut.preCheck(loja.id, "OWNER")

      expect(resultado.pendencias[0]).toMatchObject({
        codigo: "PRODUTOS_SEM_NCM_CFOP",
        total_produtos: 2,
      })
    })

    it("a varredura ignora produtos inativos e soft-deletados", async () => {
      const loja = await criarLojaApta()
      await criarProduto(loja.id, { ncm: null, ativo: false })
      await criarProduto(loja.id, { cfop: null, deletado_em: new Date() })

      const resultado = await sut.alterarSwitch(loja.id, "OWNER", true)

      expect(resultado.emite_nfce).toBe(true)
    })

    it("a varredura aponta quais produtos corrigir", async () => {
      const loja = await criarLojaApta()
      const pendente = await criarProduto(loja.id, { nome: "Refrigerante", ncm: null })
      await criarProduto(loja.id, { nome: "Água" })

      const resultado = await sut.preCheck(loja.id, "MANAGER")

      expect(resultado.pendencias[0]?.produtos).toEqual([
        { id: pendente.id, nome: "Refrigerante" },
      ])
    })

    it("falha 2: exige o upload do Certificado A1", async () => {
      const loja = await criarLojaApta({ certificado_a1: null })

      expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
        "CERTIFICADO_A1_AUSENTE",
      ])
    })

    it("certificado sem a senha também não serve", async () => {
      const loja = await criarLojaApta({ certificado_a1_senha: null })

      expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
        "CERTIFICADO_A1_AUSENTE",
      ])
    })

    it("bloqueia sem Inscrição Estadual", async () => {
      const loja = await criarLojaApta({ ie: null })

      expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
        "IE_AUSENTE",
      ])
    })

    it("bloqueia no plano Free: sem assinatura, inadimplente ou cancelada", async () => {
      for (const statusAssinatura of [null, "PAST_DUE", "CANCELED"] as const) {
        await prisma.assinatura.deleteMany()
        await prisma.estabelecimento.deleteMany()
        const loja = await criarLojaApta({ statusAssinatura })

        expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
          "PLANO_NAO_PREMIUM",
        ])
      }
    })

    it("lista TODAS as pendências de uma vez, não só a primeira", async () => {
      const loja = await criarLojaApta({
        statusAssinatura: null,
        certificado_a1: null,
        ie: null,
      })
      await criarProduto(loja.id, { ncm: null })

      expect(await codigosDaReprovacao(sut.alterarSwitch(loja.id, "OWNER", true))).toEqual([
        "PLANO_NAO_PREMIUM",
        "CERTIFICADO_A1_AUSENTE",
        "IE_AUSENTE",
        "PRODUTOS_SEM_NCM_CFOP",
      ])
    })
  })

  describe("desligar o switch", () => {
    it("é sempre permitido, mesmo com pendências", async () => {
      const loja = await criarLojaApta({ statusAssinatura: "CANCELED", emite_nfce: true })
      await criarProduto(loja.id, { ncm: null })

      const resultado = await sut.alterarSwitch(loja.id, "OWNER", false)

      expect(resultado.emite_nfce).toBe(false)
    })
  })

  describe("RBAC (RN04/05)", () => {
    it("só o Owner (ou ADMIN) altera o switch", async () => {
      const loja = await criarLojaApta()

      await expect(sut.alterarSwitch(loja.id, "MANAGER", true)).rejects.toBeInstanceOf(
        ForbiddenError
      )
      await expect(sut.alterarSwitch(loja.id, "CASHIER", false)).rejects.toBeInstanceOf(
        ForbiddenError
      )
      await expect(sut.alterarSwitch(loja.id, "ADMIN", true)).resolves.toBeTruthy()
    })

    it("o Gestor consulta o pre-check, o Caixa não", async () => {
      const loja = await criarLojaApta()

      await expect(sut.preCheck(loja.id, "MANAGER")).resolves.toMatchObject({ apto: true })
      await expect(sut.preCheck(loja.id, "CASHIER")).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("preCheck", () => {
    it("só consulta: não liga o switch mesmo quando a loja está apta", async () => {
      const loja = await criarLojaApta()

      const resultado = await sut.preCheck(loja.id, "OWNER")

      expect(resultado).toEqual({
        apto: true,
        plano: "PREMIUM",
        emite_nfce: false,
        pendencias: [],
      })
      const noBanco = await prisma.estabelecimento.findUniqueOrThrow({ where: { id: loja.id } })
      expect(noBanco.emite_nfce).toBe(false)
    })
  })
})
