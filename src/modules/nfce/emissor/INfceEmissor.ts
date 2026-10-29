import type { DadosParaNota, EspelhoNfce } from "../espelho"

/**
 * Quem produz a nota (D3). Existe para uma emissão REAL poder ser plugada no
 * futuro sem reescrever o fluxo (gatilho após a venda paga, guarda, listagem e
 * impressão). Hoje só há a implementação simulada, e a integração real NÃO
 * será criada agora.
 */
export interface INfceEmissor {
  /**
   * `numero` já vem reservado pelo repositório, dentro da mesma transação que
   * grava a nota: assim a numeração é sequencial por loja, sem buracos e sem
   * repetição, mesmo com duas emissões simultâneas.
   */
  emitir(dados: DadosParaNota, numero: number): Promise<EspelhoNfce>
}
