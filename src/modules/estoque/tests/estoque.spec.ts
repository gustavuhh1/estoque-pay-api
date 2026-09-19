import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { EstoqueInsuficienteError, ForbiddenError, NotFoundError } from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoqueService } from "../service/EstoqueService"
import { EstoquePrismaRepository } from "../repository/EstoquePrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarUsuario() {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `user-${randomUUID()}@email.com`,
      name: "Usuário de Teste",
    },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj },
  })
}

async function criarProdutoDireto(
  estabelecimentoId: string,
  overrides: Partial<{
    nome: string
    quantidade_atual: number
    quantidade_minima: number
    ativo: boolean
  }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto de Teste",
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: overrides.quantidade_atual ?? 100,
      quantidade_minima: overrides.quantidade_minima ?? 0,
      ativo: overrides.ativo ?? true,
    },
  })
}

describe("EstoqueService", () => {
  let sut: EstoqueService

  beforeEach(() => {
    sut = new EstoqueService(
      new EstoquePrismaRepository(prisma),
      new ProdutoPrismaRepository(prisma)
    )
  })

  describe("registrarMovimentacao (#47 — RF12.1 / RF13.2 / RN04 / RN05)", () => {
    it("ENTRADA soma ao saldo do produto", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 10 })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "ENTRADA",
        quantidade: 5,
        motivo: "REABASTECIMENTO",
      })

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(15)
    })

    it("SAIDA subtrai do saldo do produto", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 10 })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 4,
        motivo: "PERDA",
      })

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(6)
    })

    it("RN04: suporta frações — 1 kg menos 0.300 kg resulta em 0.7", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 1 })

      const movimentacao = await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 0.3,
        motivo: "DESCARTE",
      })

      expect(movimentacao.quantidade.toString()).toBe("0.3")

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(0.7)
    })

    it("RN05: grava o registro de auditoria com usuário, tipo e motivo", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 10 })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 2,
        motivo: "VENCIMENTO",
        observacao: "Lote vencido",
      })

      const registros = await prisma.movimentacaoEstoque.findMany({
        where: { produto_id: produto.id },
      })
      expect(registros).toHaveLength(1)
      expect(registros[0]?.usuario_id).toBe(usuario.id)
      expect(registros[0]?.tipo).toBe("SAIDA")
      expect(registros[0]?.motivo).toBe("VENCIMENTO")
      expect(registros[0]?.observacao).toBe("Lote vencido")
    })

    it("SAIDA que zera exatamente o saldo é permitida", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 5 })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 5,
        motivo: "PERDA",
      })

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(0)
    })

    it("SAIDA maior que o saldo lança EstoqueInsuficienteError", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 3 })

      await expect(
        sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 4,
          motivo: "PERDA",
        })
      ).rejects.toBeInstanceOf(EstoqueInsuficienteError)
    })

    it("RN05: estoque insuficiente reverte tudo — saldo intacto e nenhuma linha de auditoria", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 3 })

      await expect(
        sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
          produto_id: produto.id,
          tipo: "SAIDA",
          quantidade: 10,
          motivo: "PERDA",
        })
      ).rejects.toBeInstanceOf(EstoqueInsuficienteError)

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(3)

      const registros = await prisma.movimentacaoEstoque.count({
        where: { produto_id: produto.id },
      })
      expect(registros).toBe(0)
    })

    it("produto inativo aceita movimentação (baixa por perda continua necessária)", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, {
        quantidade_atual: 10,
        ativo: false,
      })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 1,
        motivo: "PERDA",
      })

      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(Number(noBanco?.quantidade_atual)).toBe(9)
    })

    it("lança NotFoundError para produto de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const usuario = await criarUsuario()
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await expect(
        sut.registrarMovimentacao(lojaA.id, usuario.id, "OWNER", {
          produto_id: produtoDaLojaB.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lança NotFoundError para produto soft-deletado", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id)
      await prisma.produto.update({
        where: { id: produto.id },
        data: { deletado_em: new Date() },
      })

      await expect(
        sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("CASHIER não pode movimentar estoque", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id)

      await expect(
        sut.registrarMovimentacao(loja.id, usuario.id, "CASHIER", {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade: 1,
          motivo: "REABASTECIMENTO",
        })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("listMovimentacoes (#48 — RF15.4)", () => {
    it("retorna o histórico em ordem cronológica decrescente", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 100 })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "ENTRADA",
        quantidade: 1,
        motivo: "REABASTECIMENTO",
      })
      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 2,
        motivo: "PERDA",
      })

      const resultado = await sut.listMovimentacoes(loja.id, "OWNER", { page: 1, limit: 20 })

      expect(resultado.total).toBe(2)
      expect(resultado.data[0]?.tipo).toBe("SAIDA")
      expect(resultado.data[1]?.tipo).toBe("ENTRADA")
    })

    it("RF15.4: traz o nome do produto e do usuário responsável", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { nome: "Queijo Minas" })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produto.id,
        tipo: "SAIDA",
        quantidade: 1,
        motivo: "DESCARTE",
      })

      const resultado = await sut.listMovimentacoes(loja.id, "OWNER", { page: 1, limit: 20 })

      expect(resultado.data[0]?.produto.nome).toBe("Queijo Minas")
      expect(resultado.data[0]?.users.name).toBe("Usuário de Teste")
    })

    it("pagina corretamente (total reflete o todo, data respeita o limit)", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produto = await criarProdutoDireto(loja.id, { quantidade_atual: 100 })

      for (const quantidade of [1, 2, 3]) {
        await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
          produto_id: produto.id,
          tipo: "ENTRADA",
          quantidade,
          motivo: "REABASTECIMENTO",
        })
      }

      const pagina1 = await sut.listMovimentacoes(loja.id, "OWNER", { page: 1, limit: 2 })
      const pagina2 = await sut.listMovimentacoes(loja.id, "OWNER", { page: 2, limit: 2 })

      expect(pagina1.total).toBe(3)
      expect(pagina1.data).toHaveLength(2)
      expect(pagina1.page).toBe(1)
      expect(pagina1.limit).toBe(2)
      expect(pagina2.data).toHaveLength(1)
    })

    it("filtra por produto_id", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()
      const produtoA = await criarProdutoDireto(loja.id, { nome: "Produto A" })
      const produtoB = await criarProdutoDireto(loja.id, { nome: "Produto B" })

      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produtoA.id,
        tipo: "ENTRADA",
        quantidade: 1,
        motivo: "REABASTECIMENTO",
      })
      await sut.registrarMovimentacao(loja.id, usuario.id, "OWNER", {
        produto_id: produtoB.id,
        tipo: "ENTRADA",
        quantidade: 1,
        motivo: "REABASTECIMENTO",
      })

      const resultado = await sut.listMovimentacoes(loja.id, "OWNER", {
        produto_id: produtoA.id,
        page: 1,
        limit: 20,
      })

      expect(resultado.total).toBe(1)
      expect(resultado.data[0]?.produto_id).toBe(produtoA.id)
    })

    it("não vaza movimentação de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const usuario = await criarUsuario()
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      await sut.registrarMovimentacao(lojaB.id, usuario.id, "OWNER", {
        produto_id: produtoDaLojaB.id,
        tipo: "ENTRADA",
        quantidade: 1,
        motivo: "REABASTECIMENTO",
      })

      const resultado = await sut.listMovimentacoes(lojaA.id, "OWNER", { page: 1, limit: 20 })

      expect(resultado.total).toBe(0)
    })

    it("CASHIER não pode consultar a auditoria", async () => {
      const loja = await criarEstabelecimento()

      await expect(
        sut.listMovimentacoes(loja.id, "CASHIER", { page: 1, limit: 20 })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("listAlertas (#49 — RF16.1 / RF17.2)", () => {
    it("inclui produto com saldo abaixo do mínimo", async () => {
      const loja = await criarEstabelecimento()
      await criarProdutoDireto(loja.id, { quantidade_atual: 2, quantidade_minima: 5 })

      const resultado = await sut.listAlertas(loja.id, "OWNER")

      expect(resultado).toHaveLength(1)
    })

    it("inclui produto com saldo exatamente igual ao mínimo", async () => {
      const loja = await criarEstabelecimento()
      await criarProdutoDireto(loja.id, { quantidade_atual: 5, quantidade_minima: 5 })

      const resultado = await sut.listAlertas(loja.id, "OWNER")

      expect(resultado).toHaveLength(1)
    })

    it("exclui produto com saldo acima do mínimo", async () => {
      const loja = await criarEstabelecimento()
      await criarProdutoDireto(loja.id, { quantidade_atual: 10, quantidade_minima: 5 })

      const resultado = await sut.listAlertas(loja.id, "OWNER")

      expect(resultado).toHaveLength(0)
    })

    it("exclui produto inativo mesmo zerado", async () => {
      const loja = await criarEstabelecimento()
      await criarProdutoDireto(loja.id, {
        quantidade_atual: 0,
        quantidade_minima: 5,
        ativo: false,
      })

      const resultado = await sut.listAlertas(loja.id, "OWNER")

      expect(resultado).toHaveLength(0)
    })

    it("exclui produto soft-deletado mesmo zerado", async () => {
      const loja = await criarEstabelecimento()
      const produto = await criarProdutoDireto(loja.id, {
        quantidade_atual: 0,
        quantidade_minima: 5,
      })
      await prisma.produto.update({
        where: { id: produto.id },
        data: { deletado_em: new Date() },
      })

      const resultado = await sut.listAlertas(loja.id, "OWNER")

      expect(resultado).toHaveLength(0)
    })

    it("não vaza produto de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarProdutoDireto(lojaB.id, { quantidade_atual: 0, quantidade_minima: 5 })

      const resultado = await sut.listAlertas(lojaA.id, "OWNER")

      expect(resultado).toHaveLength(0)
    })

    it("CASHIER não pode consultar alertas", async () => {
      const loja = await criarEstabelecimento()

      await expect(sut.listAlertas(loja.id, "CASHIER")).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
