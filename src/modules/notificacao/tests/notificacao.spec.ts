import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma, type Notificacao } from "../../../../generated/prisma/client.js"
import { NotFoundError } from "@/shared/errors"
import { NotificacaoService } from "../service/NotificacaoService"
import type {
  CriarNotificacaoParams,
  INotificacaoRepository,
  ProdutoEstoque,
} from "../repository/INotificacaoRepository"

const LOJA = "loja-1"

/**
 * Repositório em memória: os testes deste arquivo exercitam só a REGRA dos
 * gatilhos (quando notificar, com que texto, deduplicação). O SQL de verdade,
 * inclusive o índice parcial, é coberto pelo e2e.
 */
class NotificacaoRepositoryEmMemoria implements INotificacaoRepository {
  notificacoes: Notificacao[] = []
  produtos: ProdutoEstoque[] = []
  vendasEmDinheiro = new Prisma.Decimal(0)

  async criar(params: CriarNotificacaoParams) {
    const chave = params.chave ?? null
    const duplicada =
      chave !== null &&
      this.notificacoes.some(
        (n) => n.estabelecimento_id === params.estabelecimento_id && n.chave === chave && !n.lida_em
      )
    if (duplicada) return false

    this.notificacoes.push({
      id: `n-${this.notificacoes.length + 1}`,
      estabelecimento_id: params.estabelecimento_id,
      tipo: params.tipo,
      titulo: params.titulo,
      mensagem: params.mensagem,
      link: params.link ?? null,
      chave,
      lida_em: null,
      criada_em: new Date(),
    })
    return true
  }

  async listar(estabelecimentoId: string, limite: number) {
    return this.notificacoes
      .filter((n) => n.estabelecimento_id === estabelecimentoId)
      .reverse()
      .slice(0, limite)
  }

  async contarNaoLidas(estabelecimentoId: string) {
    return this.notificacoes.filter((n) => n.estabelecimento_id === estabelecimentoId && !n.lida_em)
      .length
  }

  async marcarLida(id: string, estabelecimentoId: string) {
    const n = this.notificacoes.find((x) => x.id === id && x.estabelecimento_id === estabelecimentoId)
    if (!n) return null
    n.lida_em ??= new Date()
    return n
  }

  async marcarTodasLidas(estabelecimentoId: string) {
    let total = 0
    for (const n of this.notificacoes) {
      if (n.estabelecimento_id === estabelecimentoId && !n.lida_em) {
        n.lida_em = new Date()
        total++
      }
    }
    return total
  }

  async buscarProdutos(_estabelecimentoId: string, ids: string[]) {
    return this.produtos.filter((p) => ids.includes(p.id))
  }

  async somarVendasEmDinheiroDoTurno() {
    return this.vendasEmDinheiro
  }
}

function produto(overrides: Partial<ProdutoEstoque> & { atual: number; minimo: number }): ProdutoEstoque {
  return {
    id: overrides.id ?? "p-1",
    nome: overrides.nome ?? "Arroz 5kg",
    tipo_medida: overrides.tipo_medida ?? "UNIDADE",
    quantidade_atual: new Prisma.Decimal(overrides.atual),
    quantidade_minima: new Prisma.Decimal(overrides.minimo),
    deletado_em: overrides.deletado_em ?? null,
  }
}

describe("NotificacaoService", () => {
  let repo: NotificacaoRepositoryEmMemoria
  let sut: NotificacaoService

  beforeEach(() => {
    repo = new NotificacaoRepositoryEmMemoria()
    sut = new NotificacaoService(repo)
  })

  describe("aposSaidaDeEstoque", () => {
    it("ESTOQUE_BAIXO quando a saída cruza o mínimo", async () => {
      // Tinha 6, saíram 2, ficou 4 com mínimo 5.
      repo.produtos = [produto({ atual: 4, minimo: 5 })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 2 }])

      expect(repo.notificacoes).toHaveLength(1)
      expect(repo.notificacoes[0]).toMatchObject({
        tipo: "ESTOQUE_BAIXO",
        titulo: "Estoque baixo: Arroz 5kg",
        mensagem: "Restam 4 unidades (mínimo: 5 unidades).",
        link: "/estoque",
        chave: "estoque-baixo:p-1",
      })
    })

    it("não repete o aviso se o produto JÁ estava abaixo do mínimo", async () => {
      // Tinha 4 (já abaixo de 5), saiu 1.
      repo.produtos = [produto({ atual: 3, minimo: 5 })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 1 }])

      expect(repo.notificacoes).toHaveLength(0)
    })

    it("ESTOQUE_ZERADO (e não BAIXO) quando chega a zero", async () => {
      repo.produtos = [produto({ atual: 0, minimo: 5 })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 10 }])

      expect(repo.notificacoes.map((n) => n.tipo)).toEqual(["ESTOQUE_ZERADO"])
      expect(repo.notificacoes[0]!.titulo).toBe("Arroz 5kg esgotou")
    })

    it("soma linhas repetidas do mesmo produto antes de comparar", async () => {
      // 6 -> 4 em duas linhas de 1: só cruza somando as duas.
      repo.produtos = [produto({ atual: 4, minimo: 5 })]

      await sut.aposSaidaDeEstoque(LOJA, [
        { produto_id: "p-1", quantidade: 1 },
        { produto_id: "p-1", quantidade: 1 },
      ])

      expect(repo.notificacoes).toHaveLength(1)
    })

    it("mínimo zero não gera aviso de estoque baixo", async () => {
      repo.produtos = [produto({ atual: 3, minimo: 0 })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 5 }])

      expect(repo.notificacoes).toHaveLength(0)
    })

    it("formata produto fracionado em kg", async () => {
      repo.produtos = [produto({ atual: 0.75, minimo: 1, tipo_medida: "FRACIONADO_KG", nome: "Queijo" })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 0.5 }])

      expect(repo.notificacoes[0]!.mensagem).toBe("Restam 0,75 kg (mínimo: 1 kg).")
    })

    it("ignora produto excluído", async () => {
      repo.produtos = [produto({ atual: 0, minimo: 5, deletado_em: new Date() })]

      await sut.aposSaidaDeEstoque(LOJA, [{ produto_id: "p-1", quantidade: 1 }])

      expect(repo.notificacoes).toHaveLength(0)
    })
  })

  describe("deduplicação pela chave", () => {
    it("não cria duas não lidas com a mesma chave; depois de lida, volta a notificar", async () => {
      const params = {
        estabelecimento_id: LOJA,
        tipo: "ESTOQUE_BAIXO" as const,
        titulo: "x",
        mensagem: "y",
        chave: "estoque-baixo:p-1",
      }

      expect(await sut.notificar(params)).toBe(true)
      expect(await sut.notificar(params)).toBe(false)

      await sut.marcarTodasLidas(LOJA)

      expect(await sut.notificar(params)).toBe(true)
    })
  })

  describe("gatilhos de venda", () => {
    const venda = {
      id: "v-1",
      estabelecimento_id: LOJA,
      total_venda: new Prisma.Decimal("49.90"),
      itens: [{ produto_id: "p-1", quantidade: new Prisma.Decimal(2) }],
    }

    it("PIX_CONFIRMADO com o valor e, junto, confere o estoque", async () => {
      repo.produtos = [produto({ atual: 4, minimo: 5 })]

      await sut.aposPixConfirmado(venda)

      expect(repo.notificacoes.map((n) => n.tipo)).toEqual(["PIX_CONFIRMADO", "ESTOQUE_BAIXO"])
      expect(repo.notificacoes[0]!.mensagem).toBe("Pagamento de R$ 49,90 recebido via Pix.")
      expect(repo.notificacoes[0]!.link).toBe("/vendas")
    })

    it("VENDA_CANCELADA com valor e quantidade de itens", async () => {
      await sut.aposVendaCancelada(venda)

      expect(repo.notificacoes[0]).toMatchObject({
        tipo: "VENDA_CANCELADA",
        mensagem:
          "Uma venda de R$ 49,90 (1 item) foi cancelada e os produtos voltaram ao estoque.",
      })
    })
  })

  describe("aposFechamentoCaixa", () => {
    const turno = {
      id: "t-1",
      estabelecimento_id: LOJA,
      valor_abertura: new Prisma.Decimal(100),
      valor_fechamento: new Prisma.Decimal(0),
    }

    it("FALTA quando o contado é menor que fundo + vendas em dinheiro", async () => {
      repo.vendasEmDinheiro = new Prisma.Decimal("50.25")

      await sut.aposFechamentoCaixa({ ...turno, valor_fechamento: new Prisma.Decimal(140) })

      expect(repo.notificacoes[0]).toMatchObject({
        tipo: "CAIXA_DIFERENCA",
        titulo: "Falta no fechamento do caixa",
        mensagem: "Esperado R$ 150,25, contado R$ 140,00: falta de R$ 10,25.",
      })
    })

    it("SOBRA quando o contado é maior", async () => {
      await sut.aposFechamentoCaixa({ ...turno, valor_fechamento: new Prisma.Decimal(105) })

      expect(repo.notificacoes[0]!.titulo).toBe("Sobra no fechamento do caixa")
    })

    it("não notifica quando bate", async () => {
      repo.vendasEmDinheiro = new Prisma.Decimal(20)

      await sut.aposFechamentoCaixa({ ...turno, valor_fechamento: new Prisma.Decimal(120) })

      expect(repo.notificacoes).toHaveLength(0)
    })
  })

  describe("falha ao notificar nunca quebra a operação", () => {
    it("gatilhos engolem o erro do repositório e só logam", async () => {
      const erro = new Error("banco fora do ar")
      repo.criar = vi.fn().mockRejectedValue(erro)
      repo.buscarProdutos = vi.fn().mockRejectedValue(erro)
      repo.somarVendasEmDinheiroDoTurno = vi.fn().mockRejectedValue(erro)
      const log = vi.spyOn(console, "error").mockImplementation(() => {})

      const venda = { id: "v", estabelecimento_id: LOJA, total_venda: 10, itens: [{ produto_id: "p", quantidade: 1 }] }
      await expect(sut.aposVendaPaga(venda)).resolves.toBeUndefined()
      await expect(sut.aposPixConfirmado(venda)).resolves.toBeUndefined()
      await expect(sut.aposVendaCancelada(venda)).resolves.toBeUndefined()
      await expect(
        sut.aposFechamentoCaixa({ id: "t", estabelecimento_id: LOJA, valor_abertura: 0, valor_fechamento: 5 })
      ).resolves.toBeUndefined()
      expect(await sut.notificar({ estabelecimento_id: LOJA, tipo: "PIX_CONFIRMADO", titulo: "", mensagem: "" })).toBe(false)

      expect(log).toHaveBeenCalled()
      log.mockRestore()
    })
  })

  describe("leitura", () => {
    it("listar devolve itens e total de não lidas", async () => {
      await sut.notificar({ estabelecimento_id: LOJA, tipo: "PIX_CONFIRMADO", titulo: "a", mensagem: "a" })
      await sut.notificar({ estabelecimento_id: LOJA, tipo: "PIX_CONFIRMADO", titulo: "b", mensagem: "b" })
      await sut.marcarLida(LOJA, "n-1")

      const { itens, nao_lidas } = await sut.listar(LOJA, 30)

      expect(itens.map((n) => n.titulo)).toEqual(["b", "a"])
      expect(nao_lidas).toBe(1)
    })

    it("marcarLida de notificação inexistente/de outra loja é 404", async () => {
      await sut.notificar({ estabelecimento_id: "outra", tipo: "PIX_CONFIRMADO", titulo: "a", mensagem: "a" })

      await expect(sut.marcarLida(LOJA, "n-1")).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
