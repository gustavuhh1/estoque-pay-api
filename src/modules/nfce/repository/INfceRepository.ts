import type {
  ItemVenda,
  MetodoPagamento,
  NfeStatus,
  StatusPagamento,
} from "../../../../generated/prisma/client.js"
import type { EspelhoNfce } from "../espelho"

/** A venda com tudo o que a nota precisa, lida de uma vez. */
export interface VendaParaNota {
  id: string
  estabelecimento_id: string
  status_pagamento: StatusPagamento
  metodo_pagamento: MetodoPagamento
  total_venda: { toNumber(): number }
  taxa_split: { toNumber(): number } | null
  pago_em: Date | null
  nfe_numero: number | null
  itens: Array<
    Pick<ItemVenda, "quantidade" | "preco_unitario" | "subtotal"> & { produto: { nome: string } }
  >
  cliente: { nome: string; cpf: string } | null
  estabelecimento: { nome: string; cnpj: string; ie: string | null; emite_nfce: boolean }
}

export interface NotaRegistrada {
  venda_id: string
  numero: number
  status: NfeStatus
  espelho: EspelhoNfce
}

export interface RegistrarNotaParams {
  venda_id: string
  /**
   * Monta a nota com o número já reservado. Roda DENTRO da transação: se
   * lançar, o número reservado volta atrás e a numeração não ganha buraco.
   */
  gerar: (numero: number) => Promise<EspelhoNfce>
}

export interface INfceRepository {
  findVendaParaNota(vendaId: string): Promise<VendaParaNota | null>
  /**
   * Reserva o próximo número da loja e grava a nota na MESMA transação. A
   * reserva é um update condicional em `nfe_numero IS NULL`, então duas
   * emissões simultâneas da mesma venda disputam a linha e só uma cria a nota
   * (a outra recebe `criada: false`), sem gastar número.
   */
  registrarNota(params: RegistrarNotaParams): Promise<{ criada: boolean }>
  /** Falha ao gerar: marca ERRO com a mensagem e conta a tentativa. */
  registrarErro(vendaId: string, mensagem: string): Promise<void>
  findNota(vendaId: string, estabelecimentoId: string): Promise<NotaRegistrada | null>
  listar(
    estabelecimentoId: string,
    paginacao: { page: number; limit: number }
  ): Promise<{ data: NotaRegistrada[]; total: number }>
}
