import { Prisma, type TipoMedida } from "../../../../generated/prisma/client.js"
import { NotFoundError } from "@/shared/errors"
import type {
  CriarNotificacaoParams,
  INotificacaoRepository,
} from "../repository/INotificacaoRepository"

/** O que os gatilhos precisam saber de uma venda (VendaComItens satisfaz). */
export interface VendaNotificavel {
  id: string
  estabelecimento_id: string
  total_venda: Prisma.Decimal | number
  itens: Array<{ produto_id: string; quantidade: Prisma.Decimal | number }>
}

/** O que o gatilho de fechamento precisa saber do turno (TurnoCaixa satisfaz). */
export interface TurnoNotificavel {
  id: string
  estabelecimento_id: string
  valor_abertura: Prisma.Decimal | number
  valor_fechamento: Prisma.Decimal | number | null
}

export interface SaidaDeEstoque {
  produto_id: string
  quantidade: Prisma.Decimal | number
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function formatarMoeda(valor: Prisma.Decimal | number) {
  // O Intl separa o "R$" com espaço não separável; espaço comum lê igual no front.
  return moeda.format(Number(valor)).replace(/\s/g, " ")
}

function formatarQuantidade(valor: Prisma.Decimal, tipo: TipoMedida) {
  if (tipo === "FRACIONADO_KG") {
    return `${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`
  }

  const unidades = Number(valor)
  return `${unidades.toLocaleString("pt-BR")} ${unidades === 1 ? "unidade" : "unidades"}`
}

/**
 * Notificações da loja (o sininho do painel).
 *
 * Os gatilhos (`apos*`) são chamados pelos outros módulos DEPOIS que a operação
 * principal já foi gravada, e NUNCA lançam: um aviso que falhou não pode
 * desfazer uma venda, um cancelamento ou um fechamento de caixa. Por isso cada
 * gatilho passa por `semFalhar`, que só registra o erro no log.
 *
 * As notificações são da LOJA (não da pessoa): qualquer membro vê e marca como
 * lida para todos — mesma lógica do turno de caixa.
 */
export class NotificacaoService {
  constructor(private notificacaoRepository: INotificacaoRepository) {}

  // ============== API (rotas /notificacao) ==============

  async listar(estabelecimentoId: string, limite: number) {
    const [itens, nao_lidas] = await Promise.all([
      this.notificacaoRepository.listar(estabelecimentoId, limite),
      this.notificacaoRepository.contarNaoLidas(estabelecimentoId),
    ])

    return { itens, nao_lidas }
  }

  async marcarLida(estabelecimentoId: string, id: string) {
    const notificacao = await this.notificacaoRepository.marcarLida(id, estabelecimentoId)

    // Notificação de outra loja é indistinguível de inexistente, de propósito.
    if (!notificacao) {
      throw new NotFoundError(
        "Notificação não encontrada nesta loja.",
        "NOTIFICACAO_NAO_ENCONTRADA"
      )
    }

    return notificacao
  }

  async marcarTodasLidas(estabelecimentoId: string) {
    const atualizadas = await this.notificacaoRepository.marcarTodasLidas(estabelecimentoId)

    return { atualizadas }
  }

  // ============== Núcleo ==============

  /**
   * Grava uma notificação sem nunca lançar. Devolve `true` se gravou e `false`
   * se foi deduplicada pela `chave` ou se deu erro (que fica no log).
   */
  async notificar(params: CriarNotificacaoParams): Promise<boolean> {
    return this.semFalhar("notificar", () => this.notificacaoRepository.criar(params), false)
  }

  // ============== Gatilhos ==============

  /**
   * Estoque cruzou o mínimo ou zerou. Recebe as SAÍDAS que acabaram de ser
   * gravadas (itens da venda paga ou a saída manual) e relê o saldo: com o
   * saldo de agora e a quantidade que saiu dá para saber o de antes, e só
   * notifica quem CRUZOU a linha nesta operação. Produto que já estava abaixo
   * do mínimo não gera um aviso a cada venda (e a `chave` ainda deduplica o que
   * estiver não lido).
   */
  async aposSaidaDeEstoque(estabelecimentoId: string, saidas: SaidaDeEstoque[]): Promise<void> {
    await this.semFalhar(
      "aposSaidaDeEstoque",
      async () => {
        // O mesmo produto pode aparecer em mais de uma linha do carrinho.
        const saidaPorProduto = new Map<string, Prisma.Decimal>()
        for (const saida of saidas) {
          const anterior = saidaPorProduto.get(saida.produto_id) ?? new Prisma.Decimal(0)
          saidaPorProduto.set(saida.produto_id, anterior.add(saida.quantidade.toString()))
        }

        if (saidaPorProduto.size === 0) return

        const produtos = await this.notificacaoRepository.buscarProdutos(estabelecimentoId, [
          ...saidaPorProduto.keys(),
        ])

        for (const produto of produtos) {
          if (produto.deletado_em) continue

          const depois = new Prisma.Decimal(produto.quantidade_atual.toString())
          const minimo = new Prisma.Decimal(produto.quantidade_minima.toString())
          const antes = depois.add(saidaPorProduto.get(produto.id) ?? 0)

          if (antes.greaterThan(0) && depois.lessThanOrEqualTo(0)) {
            await this.notificar({
              estabelecimento_id: estabelecimentoId,
              tipo: "ESTOQUE_ZERADO",
              titulo: `${produto.nome} esgotou`,
              mensagem: `O estoque de ${produto.nome} chegou a zero. Reponha para não perder vendas.`,
              link: "/estoque",
              chave: `estoque-zerado:${produto.id}`,
            })
          } else if (
            minimo.greaterThan(0) &&
            antes.greaterThan(minimo) &&
            depois.lessThanOrEqualTo(minimo)
          ) {
            await this.notificar({
              estabelecimento_id: estabelecimentoId,
              tipo: "ESTOQUE_BAIXO",
              titulo: `Estoque baixo: ${produto.nome}`,
              mensagem: `Restam ${formatarQuantidade(depois, produto.tipo_medida)} (mínimo: ${formatarQuantidade(minimo, produto.tipo_medida)}).`,
              link: "/estoque",
              chave: `estoque-baixo:${produto.id}`,
            })
          }
        }
      },
      undefined
    )
  }

  /** Venda paga em dinheiro/cartão: só o estoque interessa (avisar toda venda seria ruído). */
  async aposVendaPaga(venda: VendaNotificavel): Promise<void> {
    await this.aposSaidaDeEstoque(venda.estabelecimento_id, venda.itens)
  }

  /** Pix confirmado: avisa o dinheiro na conta e confere o estoque que acabou de baixar. */
  async aposPixConfirmado(venda: VendaNotificavel): Promise<void> {
    await this.notificar({
      estabelecimento_id: venda.estabelecimento_id,
      tipo: "PIX_CONFIRMADO",
      titulo: "Pix confirmado",
      mensagem: `Pagamento de ${formatarMoeda(venda.total_venda)} recebido via Pix.`,
      link: "/vendas",
      chave: `pix-confirmado:${venda.id}`,
    })
    await this.aposSaidaDeEstoque(venda.estabelecimento_id, venda.itens)
  }

  async aposVendaCancelada(venda: VendaNotificavel): Promise<void> {
    const itens = venda.itens.length
    await this.notificar({
      estabelecimento_id: venda.estabelecimento_id,
      tipo: "VENDA_CANCELADA",
      titulo: "Venda cancelada",
      mensagem: `Uma venda de ${formatarMoeda(venda.total_venda)} (${itens} ${itens === 1 ? "item" : "itens"}) foi cancelada e os produtos voltaram ao estoque.`,
      link: "/vendas",
      chave: `venda-cancelada:${venda.id}`,
    })
  }

  /**
   * Fechamento com sobra ou falta. Esperado = fundo de troco + vendas em
   * DINHEIRO pagas no turno (Pix e cartão não passam pela gaveta) — a mesma
   * conta que o front mostra no fechamento.
   */
  async aposFechamentoCaixa(turno: TurnoNotificavel): Promise<void> {
    await this.semFalhar(
      "aposFechamentoCaixa",
      async () => {
        if (turno.valor_fechamento === null) return

        const vendasEmDinheiro =
          await this.notificacaoRepository.somarVendasEmDinheiroDoTurno(turno.id)
        const esperado = new Prisma.Decimal(turno.valor_abertura.toString()).add(
          vendasEmDinheiro.toString()
        )
        const contado = new Prisma.Decimal(turno.valor_fechamento.toString())
        const diferenca = contado.sub(esperado)

        if (diferenca.isZero()) return

        const sobra = diferenca.greaterThan(0)
        await this.notificar({
          estabelecimento_id: turno.estabelecimento_id,
          tipo: "CAIXA_DIFERENCA",
          titulo: sobra ? "Sobra no fechamento do caixa" : "Falta no fechamento do caixa",
          mensagem: `Esperado ${formatarMoeda(esperado)}, contado ${formatarMoeda(contado)}: ${sobra ? "sobra" : "falta"} de ${formatarMoeda(diferenca.abs())}.`,
          link: "/vendas",
          chave: `caixa-diferenca:${turno.id}`,
        })
      },
      undefined
    )
  }

  /** Roda o gatilho engolindo qualquer erro: a notificação é acessória à operação. */
  private async semFalhar<T>(origem: string, acao: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await acao()
    } catch (erro) {
      console.error(`[notificacao] Falha em ${origem}; a operação principal segue normalmente.`, erro)
      return fallback
    }
  }
}
