import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  CupomCodigoAlreadyInUseError,
  CupomDeOutroClienteError,
  CupomExpiradoError,
  CupomJaResgatadoError,
  EstoqueInsuficienteError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { EstoquePrismaRepository } from "@/modules/estoque/repository/EstoquePrismaRepository"
import { CaixaPrismaRepository } from "@/modules/caixa/repository/CaixaPrismaRepository"
import { VendaPrismaRepository } from "@/modules/venda/repository/VendaPrismaRepository"
import { VendaService } from "@/modules/venda/service/VendaService"
import { PagamentoService } from "@/modules/pagamento/service/PagamentoService"
import { InMemoryPagamentoGateway } from "@/modules/pagamento/gateway/InMemoryPagamentoGateway"
import { ClientePrismaRepository } from "../repository/ClientePrismaRepository"
import { CupomPrismaRepository } from "../repository/CupomPrismaRepository"
import { ClienteService } from "../service/ClienteService"
import { CupomService } from "../service/CupomService"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"
const CPF_VALIDO = "52998224725"
const OUTRO_CPF_VALIDO = "11144477735"

async function criarUsuario() {
  return prisma.user.create({
    data: { id: randomUUID(), email: `user-${randomUUID()}@email.com`, name: "Operador" },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

async function criarProduto(
  estabelecimentoId: string,
  overrides: Partial<{ nome: string; preco_venda: number; quantidade_atual: number }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: overrides.nome ?? "Produto",
      preco_custo: 5,
      preco_venda: overrides.preco_venda ?? 10,
      quantidade_atual: overrides.quantidade_atual ?? 100,
      quantidade_minima: 0,
    },
  })
}

async function criarCliente(estabelecimentoId: string, cpf = CPF_VALIDO) {
  return prisma.cliente.create({
    data: { estabelecimento_id: estabelecimentoId, nome: "Maria", cpf },
  })
}

describe("CRM — Histórico, Inteligência e Fidelidade (#58)", () => {
  let clienteService: ClienteService
  let cupomService: CupomService
  let pagamentoService: PagamentoService
  let vendaService: VendaService
  let caixaRepository: CaixaPrismaRepository

  beforeEach(() => {
    const estoqueRepository = new EstoquePrismaRepository(prisma)
    const vendaRepository = new VendaPrismaRepository(prisma, estoqueRepository)
    const clienteRepository = new ClientePrismaRepository(prisma)
    caixaRepository = new CaixaPrismaRepository(prisma)

    clienteService = new ClienteService(clienteRepository)
    cupomService = new CupomService(new CupomPrismaRepository(prisma), clienteRepository)
    vendaService = new VendaService(new ProdutoPrismaRepository(prisma), vendaRepository)
    pagamentoService = new PagamentoService(
      vendaRepository,
      vendaService,
      caixaRepository,
      clienteService,
      cupomService,
      new InMemoryPagamentoGateway()
    )
  })

  /** Loja com caixa aberto, um operador e um cliente — o ponto de partida. */
  async function cenario(cnpj = CNPJ_VALIDO) {
    const loja = await criarEstabelecimento(cnpj)
    const usuario = await criarUsuario()
    await caixaRepository.abrir({
      estabelecimento_id: loja.id,
      aberto_por_id: usuario.id,
      valor_abertura: 100,
    })
    const cliente = await criarCliente(loja.id)
    return { loja, usuario, cliente }
  }

  describe("RF02.1 — vínculo da venda ao cliente", () => {
    it("a venda paga com cliente_id é indexada ao perfil do cliente", async () => {
      const { loja, usuario, cliente } = await cenario()
      const produto = await criarProduto(loja.id)

      const { venda } = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 2 }],
        metodo_pagamento: "DEBITO",
        cliente_id: cliente.id,
      })

      expect(venda.cliente_id).toBe(cliente.id)

      const historico = await clienteService.listarCompras(cliente.id, loja.id, {
        page: 1,
        limit: 20,
      })
      expect(historico.total).toBe(1)
      expect(historico.data[0]?.id).toBe(venda.id)
      expect(historico.data[0]?.itens[0]?.produto.nome).toBe("Produto")
    })

    it("recusa cliente de outra loja, sem gravar venda nem baixar estoque", async () => {
      const { loja, usuario } = await cenario()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const clienteDeFora = await criarCliente(outraLoja.id)
      const produto = await criarProduto(loja.id, { quantidade_atual: 10 })

      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: clienteDeFora.id,
        })
      ).rejects.toBeInstanceOf(NotFoundError)

      expect(await prisma.venda.count()).toBe(0)
      const noBanco = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })
      expect(Number(noBanco.quantidade_atual)).toBe(10)
    })

    it("cliente_id inexistente vira 404, não erro de FK", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id)

      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: randomUUID(),
        })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("o histórico traz as canceladas, da mais recente para a mais antiga", async () => {
      const { loja, usuario, cliente } = await cenario()
      const produto = await criarProduto(loja.id)
      const pagar = () =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: cliente.id,
        })

      const primeira = await pagar()
      const segunda = await pagar()
      await vendaService.cancelar(loja.id, usuario.id, "OWNER", primeira.venda.id)

      const historico = await clienteService.listarCompras(cliente.id, loja.id, {
        page: 1,
        limit: 20,
      })

      expect(historico.data.map((venda) => venda.id)).toEqual([
        segunda.venda.id,
        primeira.venda.id,
      ])
      expect(historico.data[1]?.status_pagamento).toBe("CANCELADO")
    })

    it("histórico de cliente de outra loja é 404", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const daLojaB = await criarCliente(lojaB.id)

      await expect(
        clienteService.listarCompras(daLojaB.id, lojaA.id, { page: 1, limit: 20 })
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe("RF02.2 — inteligência de dados", () => {
    it("conta os produtos mais comprados e ordena pela frequência", async () => {
      const { loja, usuario, cliente } = await cenario()
      const cafe = await criarProduto(loja.id, { nome: "Café", preco_venda: 20 })
      const pao = await criarProduto(loja.id, { nome: "Pão", preco_venda: 1 })
      const leite = await criarProduto(loja.id, { nome: "Leite", preco_venda: 5 })
      const pagar = (itens: Array<{ produto_id: string; quantidade: number }>) =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens,
          metodo_pagamento: "DEBITO",
          cliente_id: cliente.id,
        })

      // Café em 3 compras, pão em 2 (com quantidade bem maior), leite em 1.
      await pagar([{ produto_id: cafe.id, quantidade: 1 }, { produto_id: pao.id, quantidade: 10 }])
      await pagar([{ produto_id: cafe.id, quantidade: 1 }, { produto_id: pao.id, quantidade: 10 }])
      await pagar([{ produto_id: cafe.id, quantidade: 2 }, { produto_id: leite.id, quantidade: 1 }])

      const estatisticas = await clienteService.estatisticas(cliente.id, loja.id, 5)

      expect(estatisticas.produtos_favoritos).toEqual([
        { produto_id: cafe.id, produto_nome: "Café", vezes_comprado: 3, quantidade_total: 4 },
        { produto_id: pao.id, produto_nome: "Pão", vezes_comprado: 2, quantidade_total: 20 },
        { produto_id: leite.id, produto_nome: "Leite", vezes_comprado: 1, quantidade_total: 1 },
      ])
    })

    it("calcula total de compras, valor gasto e ticket médio sem dízima", async () => {
      const { loja, usuario, cliente } = await cenario()
      const produto = await criarProduto(loja.id, { preco_venda: 10 })
      const pagar = (quantidade: number) =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade }],
          metodo_pagamento: "DEBITO",
          cliente_id: cliente.id,
        })

      await pagar(1)
      await pagar(1)
      await pagar(2)

      const estatisticas = await clienteService.estatisticas(cliente.id, loja.id, 5)

      expect(estatisticas.total_compras).toBe(3)
      expect(estatisticas.valor_total_gasto).toBe(40)
      // 40 / 3 = 13.333... -> 13.33
      expect(estatisticas.ticket_medio).toBe(13.33)
      expect(estatisticas.primeira_compra_em).toBeInstanceOf(Date)
      expect(estatisticas.ultima_compra_em).toBeInstanceOf(Date)
    })

    it("ignora vendas canceladas e vendas de outros clientes", async () => {
      const { loja, usuario, cliente } = await cenario()
      const outroCliente = await criarCliente(loja.id, OUTRO_CPF_VALIDO)
      const produto = await criarProduto(loja.id, { preco_venda: 10 })
      const pagar = (clienteId: string) =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: clienteId,
        })

      await pagar(cliente.id)
      const cancelada = await pagar(cliente.id)
      await pagar(outroCliente.id)
      await vendaService.cancelar(loja.id, usuario.id, "OWNER", cancelada.venda.id)

      const estatisticas = await clienteService.estatisticas(cliente.id, loja.id, 5)

      expect(estatisticas.total_compras).toBe(1)
      expect(estatisticas.valor_total_gasto).toBe(10)
      expect(estatisticas.produtos_favoritos[0]?.vezes_comprado).toBe(1)
    })

    it("respeita o top N", async () => {
      const { loja, usuario, cliente } = await cenario()
      const a = await criarProduto(loja.id, { nome: "A" })
      const b = await criarProduto(loja.id, { nome: "B" })

      await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: a.id, quantidade: 1 }, { produto_id: b.id, quantidade: 1 }],
        metodo_pagamento: "DEBITO",
        cliente_id: cliente.id,
      })

      const estatisticas = await clienteService.estatisticas(cliente.id, loja.id, 1)

      expect(estatisticas.produtos_favoritos).toHaveLength(1)
    })

    it("cliente sem compras devolve tudo zerado, sem dividir por zero", async () => {
      const loja = await criarEstabelecimento()
      const cliente = await criarCliente(loja.id)

      const estatisticas = await clienteService.estatisticas(cliente.id, loja.id, 5)

      expect(estatisticas).toEqual({
        cliente_id: cliente.id,
        total_compras: 0,
        valor_total_gasto: 0,
        ticket_medio: 0,
        primeira_compra_em: null,
        ultima_compra_em: null,
        produtos_favoritos: [],
      })
    })
  })

  describe("RF02.3 — emissão de cupom", () => {
    it("emite cupom nominal com o código normalizado em maiúsculas", async () => {
      const loja = await criarEstabelecimento()
      const cliente = await criarCliente(loja.id)

      const cupom = await cupomService.create(loja.id, "MANAGER", {
        cliente_id: cliente.id,
        codigo: "ANIVERSARIO-10",
        valor_desconto: 10,
      })

      expect(cupom.cliente_id).toBe(cliente.id)
      expect(cupom.codigo).toBe("ANIVERSARIO-10")
      expect(Number(cupom.valor_desconto)).toBe(10)
    })

    it("gera o código quando ele não é informado", async () => {
      const loja = await criarEstabelecimento()

      const cupom = await cupomService.create(loja.id, "OWNER", { valor_desconto: 5 })

      expect(cupom.codigo).toMatch(/^FID-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(cupom.cliente_id).toBeNull()
    })

    it("bloqueia código repetido na mesma loja", async () => {
      const loja = await criarEstabelecimento()
      await cupomService.create(loja.id, "OWNER", { codigo: "PROMO", valor_desconto: 5 })

      await expect(
        cupomService.create(loja.id, "OWNER", { codigo: "PROMO", valor_desconto: 5 })
      ).rejects.toBeInstanceOf(CupomCodigoAlreadyInUseError)
    })

    it("CASHIER não emite cupom", async () => {
      const loja = await criarEstabelecimento()

      await expect(
        cupomService.create(loja.id, "CASHIER", { valor_desconto: 5 })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it("não emite cupom nominal para cliente de outra loja", async () => {
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const daLojaB = await criarCliente(lojaB.id)

      await expect(
        cupomService.create(lojaA.id, "OWNER", { cliente_id: daLojaB.id, valor_desconto: 5 })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("lista filtrando pelos cupons do cliente", async () => {
      const loja = await criarEstabelecimento()
      const cliente = await criarCliente(loja.id)
      await cupomService.create(loja.id, "OWNER", { cliente_id: cliente.id, valor_desconto: 5 })
      await cupomService.create(loja.id, "OWNER", { valor_desconto: 5 })

      expect(await cupomService.list(loja.id, { cliente_id: cliente.id })).toHaveLength(1)
      expect(await cupomService.list(loja.id, {})).toHaveLength(2)
    })
  })

  describe("RF02.3 — resgate de cupom no pagamento", () => {
    it("aplica o desconto e baixa o cupom com o id da venda", async () => {
      const { loja, usuario, cliente } = await cenario()
      const produto = await criarProduto(loja.id, { preco_venda: 50 })
      const cupom = await cupomService.create(loja.id, "OWNER", {
        cliente_id: cliente.id,
        codigo: "FIEL-15",
        valor_desconto: 15,
      })

      const resultado = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DINHEIRO",
        valor_pago: 40,
        cliente_id: cliente.id,
        cupom_codigo: "FIEL-15",
      })

      expect(resultado.subtotal).toBe(50)
      expect(resultado.desconto).toBe(15)
      expect(Number(resultado.venda.total_venda)).toBe(35)
      // O troco é sobre o total COM desconto.
      expect(resultado.troco).toBe(5)

      const baixado = await prisma.cupom.findUniqueOrThrow({ where: { id: cupom.id } })
      expect(baixado.resgatado_em).toBeInstanceOf(Date)
      expect(baixado.venda_id).toBe(resultado.venda.id)
    })

    it("o desconto nunca deixa o total negativo", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id, { preco_venda: 8 })
      await cupomService.create(loja.id, "OWNER", { codigo: "GRANDE", valor_desconto: 20 })

      const resultado = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DEBITO",
        cupom_codigo: "GRANDE",
      })

      expect(resultado.desconto).toBe(8)
      expect(Number(resultado.venda.total_venda)).toBe(0)
    })

    it("cupom genérico vale em venda sem cliente", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id, { preco_venda: 30 })
      await cupomService.create(loja.id, "OWNER", { codigo: "LOJA-5", valor_desconto: 5 })

      const resultado = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "CREDITO",
        cupom_codigo: "LOJA-5",
      })

      expect(Number(resultado.venda.total_venda)).toBe(25)
    })

    it("cupom já resgatado é recusado", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id)
      await cupomService.create(loja.id, "OWNER", { codigo: "UNICO", valor_desconto: 5 })
      const pagar = () =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "UNICO",
        })

      await pagar()

      await expect(pagar()).rejects.toBeInstanceOf(CupomJaResgatadoError)
    })

    it("cupom expirado é recusado", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id)
      await prisma.cupom.create({
        data: {
          estabelecimento_id: loja.id,
          codigo: "VENCIDO",
          valor_desconto: 5,
          expira_em: new Date(Date.now() - 60_000),
        },
      })

      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "VENCIDO",
        })
      ).rejects.toBeInstanceOf(CupomExpiradoError)
    })

    it("cupom nominal não vale sem o cliente dono, nem para outro cliente", async () => {
      const { loja, usuario, cliente } = await cenario()
      const outroCliente = await criarCliente(loja.id, OUTRO_CPF_VALIDO)
      const produto = await criarProduto(loja.id)
      await cupomService.create(loja.id, "OWNER", {
        cliente_id: cliente.id,
        codigo: "SO-DA-MARIA",
        valor_desconto: 5,
      })
      const pagar = (clienteId?: string) =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "SO-DA-MARIA",
          ...(clienteId && { cliente_id: clienteId }),
        })

      await expect(pagar()).rejects.toBeInstanceOf(CupomDeOutroClienteError)
      await expect(pagar(outroCliente.id)).rejects.toBeInstanceOf(CupomDeOutroClienteError)
      expect(await prisma.venda.count()).toBe(0)
    })

    it("cupom de outra loja é indistinguível de inexistente", async () => {
      const { loja, usuario } = await cenario()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const produto = await criarProduto(loja.id)
      await cupomService.create(outraLoja.id, "OWNER", { codigo: "DE-FORA", valor_desconto: 5 })

      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "DE-FORA",
        })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("RNF01: se a baixa de estoque falha, o cupom NÃO fica resgatado", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id, { quantidade_atual: 1 })
      const cupom = await cupomService.create(loja.id, "OWNER", {
        codigo: "ROLLBACK",
        valor_desconto: 5,
      })

      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 5 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "ROLLBACK",
        })
      ).rejects.toBeInstanceOf(EstoqueInsuficienteError)

      const intacto = await prisma.cupom.findUniqueOrThrow({ where: { id: cupom.id } })
      expect(intacto.resgatado_em).toBeNull()
      expect(intacto.venda_id).toBeNull()
    })

    it("dois resgates simultâneos do mesmo cupom: só um desconto é concedido", async () => {
      const { loja, usuario } = await cenario()
      const produto = await criarProduto(loja.id)
      await cupomService.create(loja.id, "OWNER", { codigo: "CORRIDA", valor_desconto: 5 })
      const pagar = () =>
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cupom_codigo: "CORRIDA",
        })

      const resultados = await Promise.allSettled([pagar(), pagar()])

      const rejeitados = resultados.filter((r) => r.status === "rejected")
      expect(rejeitados).toHaveLength(1)
      expect((rejeitados[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        CupomJaResgatadoError
      )
      // A venda que perdeu a corrida voltou atrás inteira.
      expect(await prisma.venda.count()).toBe(1)
    })

    it("cancelar a venda devolve o cupom para uso", async () => {
      const { loja, usuario, cliente } = await cenario()
      const produto = await criarProduto(loja.id)
      const cupom = await cupomService.create(loja.id, "OWNER", {
        cliente_id: cliente.id,
        codigo: "VOLTA",
        valor_desconto: 5,
      })

      const { venda } = await pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
        itens: [{ produto_id: produto.id, quantidade: 1 }],
        metodo_pagamento: "DEBITO",
        cliente_id: cliente.id,
        cupom_codigo: "VOLTA",
      })

      await vendaService.cancelar(loja.id, usuario.id, "OWNER", venda.id)

      const liberado = await prisma.cupom.findUniqueOrThrow({ where: { id: cupom.id } })
      expect(liberado.resgatado_em).toBeNull()
      expect(liberado.venda_id).toBeNull()

      // E pode ser usado de novo na venda refeita.
      await expect(
        pagamentoService.registrarPagamentoManual(loja.id, usuario.id, {
          itens: [{ produto_id: produto.id, quantidade: 1 }],
          metodo_pagamento: "DEBITO",
          cliente_id: cliente.id,
          cupom_codigo: "VOLTA",
        })
      ).resolves.toBeTruthy()
    })
  })
})
