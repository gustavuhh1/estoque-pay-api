/**
 * NFC-e SIMULADA (D3, issue #81).
 *
 * A emissão fiscal REAL está fora do escopo do projeto: não há integração com
 * Focus NFe, eNotas nem SEFAZ. O que este módulo entrega é um "espelho": um
 * documento que parece uma nota, é gerado e guardado como uma, mas NÃO TEM
 * VALOR FISCAL e diz isso em todo lugar onde aparece.
 */

/**
 * O aviso é obrigatório e inegociável: aparece em toda saída (JSON, tela e
 * impressão). Uma constante só, para nenhuma saída esquecer ou reescrever o
 * texto.
 */
export const AVISO_SIMULACAO =
  "DOCUMENTO SEM VALOR FISCAL — SIMULAÇÃO (emissão real fora do escopo do projeto)"

export type FormaPagamentoNota = "PIX" | "DINHEIRO" | "DEBITO" | "CREDITO"

/** Mostrado quando a venda não tem cliente (RN03 da Fase 4: CPF é opcional). */
export const CONSUMIDOR_NAO_IDENTIFICADO = "Consumidor Não Identificado"

export interface ItemDoEspelho {
  nome: string
  quantidade: number
  preco_unitario: number
  total: number
}

/** O que o emissor precisa para produzir a nota. */
export interface DadosParaNota {
  venda_id: string
  estabelecimento: { nome: string; cnpj: string; ie: string | null }
  consumidor: { identificado: boolean; nome: string | null; cpf: string | null }
  itens: ItemDoEspelho[]
  subtotal_itens: number
  /** Desconto de cupom. 0 quando não há. */
  desconto: number
  /** Itens menos o desconto: a receita da loja. */
  total_venda: number
  /** D1: a taxa de serviço do Pix, paga pelo consumidor. null fora do Pix. */
  taxa_pix: number | null
  /** O que o consumidor efetivamente pagou: `total_venda + taxa_pix`. */
  total_cobrado: number
  forma_pagamento: FormaPagamentoNota
  pago_em: string | null
}

/**
 * Retrato imutável da nota, gravado em `Venda.nfe_espelho`. O HTML imprimível
 * é gerado DESTE retrato a cada leitura: os dados da nota (loja, preços, taxa)
 * não mudam depois de emitida mesmo que o cadastro mude, e o aviso de simulação
 * vem sempre do código, nunca de um HTML antigo guardado.
 */
export interface EspelhoNfce extends DadosParaNota {
  simulada: true
  aviso: typeof AVISO_SIMULACAO
  numero: number
  serie: number
  /** FICTÍCIA e inconfundível com uma chave real (tem letras). */
  chave_de_acesso: string
  emitida_em: string
}
