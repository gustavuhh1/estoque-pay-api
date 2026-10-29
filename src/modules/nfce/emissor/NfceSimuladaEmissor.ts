import { randomInt } from "node:crypto"
import { AVISO_SIMULACAO, type DadosParaNota, type EspelhoNfce } from "../espelho"
import type { INfceEmissor } from "./INfceEmissor"

/** Série fixa da numeração simulada. */
const SERIE_SIMULADA = 1

/**
 * Emissor SIMULADO (D3): monta o documento sem falar com ninguém.
 *
 * Nada aqui imita um documento oficial de forma enganosa:
 * - a chave de acesso é FICTÍCIA e começa com `SIMULADO`. Uma chave real tem 44
 *   dígitos; esta tem letras, então não passa em nenhuma validação nem aponta
 *   para consulta de SEFAZ;
 * - não existe protocolo de autorização nem QR Code (documentos que só a SEFAZ
 *   emite);
 * - o aviso de simulação vai dentro do documento.
 */
export class NfceSimuladaEmissor implements INfceEmissor {
  constructor(private agora: () => Date = () => new Date()) {}

  async emitir(dados: DadosParaNota, numero: number): Promise<EspelhoNfce> {
    return {
      ...dados,
      simulada: true,
      aviso: AVISO_SIMULACAO,
      numero,
      serie: SERIE_SIMULADA,
      chave_de_acesso: gerarChaveFicticia(),
      emitida_em: this.agora().toISOString(),
    }
  }
}

/** `SIMULADO` + 36 dígitos aleatórios (44 caracteres, como o tamanho de uma chave real). */
export function gerarChaveFicticia(): string {
  const digitos = Array.from({ length: 36 }, () => randomInt(0, 10)).join("")

  return `SIMULADO${digitos}`
}
