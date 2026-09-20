import type { TurnoComRelacoes } from "../dto/caixa.dto"

export interface AbrirTurnoParams {
  estabelecimento_id: string
  aberto_por_id: string
  valor_abertura: number
}

export interface FecharTurnoParams {
  id: string
  fechado_por_id: string
  valor_fechamento: number
}

export interface ICaixaRepository {
  /**
   * RF06.1. Pode lançar o P2002 do índice único parcial
   * `turnos_caixa_um_aberto_por_loja` quando duas aberturas simultâneas passam
   * pela checagem prévia do Service — quem trata é o Service.
   */
  abrir(params: AbrirTurnoParams): Promise<TurnoComRelacoes>
  /** RF06.2: grava valor final, quem fechou e o horário, e marca FECHADO. */
  fechar(params: FecharTurnoParams): Promise<TurnoComRelacoes>
  /** O turno ABERTO da loja, ou null. É um por loja (não por pessoa). */
  findAbertoByEstabelecimento(estabelecimentoId: string): Promise<TurnoComRelacoes | null>
}
