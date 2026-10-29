import type {
  INfceRepository,
  NotaRegistrada,
  RegistrarNotaParams,
  VendaParaNota,
} from "./INfceRepository"

/** Dublê para os testes unitários do service: o teste monta as vendas. */
export class InMemoryNfceRepository implements INfceRepository {
  public vendas = new Map<string, VendaParaNota>()
  public notas = new Map<string, NotaRegistrada>()
  public erros = new Map<string, string>()
  private ultimoNumero = new Map<string, number>()
  /** Faz a próxima geração falhar, para testar o registro de ERRO. */
  public falharNaGeracao: Error | null = null

  async findVendaParaNota(vendaId: string) {
    const venda = this.vendas.get(vendaId)

    if (!venda) return null

    return { ...venda, nfe_numero: this.notas.get(vendaId)?.numero ?? null }
  }

  async registrarNota({ venda_id, gerar }: RegistrarNotaParams) {
    const venda = this.vendas.get(venda_id)

    if (!venda || this.notas.has(venda_id)) {
      return { criada: false }
    }

    const numero = (this.ultimoNumero.get(venda.estabelecimento_id) ?? 0) + 1

    // Se a geração falhar, o contador NÃO anda: espelha a transação do banco.
    if (this.falharNaGeracao) {
      throw this.falharNaGeracao
    }

    const espelho = await gerar(numero)

    this.ultimoNumero.set(venda.estabelecimento_id, numero)
    this.notas.set(venda_id, { venda_id, numero, status: "AUTORIZADA", espelho })
    this.erros.delete(venda_id)

    return { criada: true }
  }

  async registrarErro(vendaId: string, mensagem: string) {
    if (!this.notas.has(vendaId)) {
      this.erros.set(vendaId, mensagem)
    }
  }

  async findNota(vendaId: string, estabelecimentoId: string) {
    const nota = this.notas.get(vendaId)
    const venda = this.vendas.get(vendaId)

    return nota && venda?.estabelecimento_id === estabelecimentoId ? nota : null
  }

  async listar(estabelecimentoId: string, { page, limit }: { page: number; limit: number }) {
    const todas = [...this.notas.values()]
      .filter((nota) => this.vendas.get(nota.venda_id)?.estabelecimento_id === estabelecimentoId)
      .sort((a, b) => b.numero - a.numero)

    return { data: todas.slice((page - 1) * limit, page * limit), total: todas.length }
  }
}
