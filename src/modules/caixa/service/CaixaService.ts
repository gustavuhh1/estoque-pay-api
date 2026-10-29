import { Prisma } from "../../../../generated/prisma/client.js"
import { NotFoundError, TurnoJaAbertoError } from "@/shared/errors"
import type { AbrirTurnoDTO, FecharTurnoDTO, TurnoComRelacoes } from "../dto/caixa.dto"
import type { ICaixaRepository } from "../repository/ICaixaRepository"

/**
 * RF06.1/RF06.2 — issue #54.
 *
 * Diferente de todos os outros módulos da Fase 03, aqui NÃO existe
 * `garantirAcesso`: qualquer cargo abre e fecha o turno, inclusive CASHIER. Na
 * operação real quem está na loja abre o caixa no começo do expediente e quem
 * está na loja fecha no fim. Ser membro da loja já é garantido pelo
 * requireTenant — é a única exigência.
 *
 * O turno é por LOJA, não por pessoa: representa "o caixa da loja está aberto".
 */
export class CaixaService {
  constructor(private caixaRepository: ICaixaRepository) {}

  /** RF06.1 */
  async abrir(
    estabelecimentoId: string,
    usuarioId: string,
    data: AbrirTurnoDTO
  ): Promise<TurnoComRelacoes> {
    // Checagem prévia só para dar o erro amigável no caso comum. Ela NÃO é a
    // garantia: entre ler e gravar existe uma janela em que duas aberturas
    // simultâneas passariam as duas. Quem realmente barra é o índice único
    // parcial no banco, tratado no catch abaixo.
    const jaAberto = await this.caixaRepository.findAbertoByEstabelecimento(estabelecimentoId)

    if (jaAberto) {
      throw new TurnoJaAbertoError()
    }

    try {
      return await this.caixaRepository.abrir({
        estabelecimento_id: estabelecimentoId,
        aberto_por_id: usuarioId,
        valor_abertura: data.valor_abertura,
      })
    } catch (error) {
      // P2002 = violação de constraint única. Aqui só pode ser o índice
      // `turnos_caixa_um_aberto_por_loja`: perdemos a corrida para outra
      // abertura simultânea, então o resultado para o cliente é o mesmo 409.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new TurnoJaAbertoError()
      }

      throw error
    }
  }

  /** RF06.2: quem fecha pode ser uma pessoa diferente de quem abriu. */
  async fechar(
    estabelecimentoId: string,
    usuarioId: string,
    data: FecharTurnoDTO
  ): Promise<TurnoComRelacoes> {
    const turno = await this.caixaRepository.findAbertoByEstabelecimento(estabelecimentoId)

    if (!turno) {
      throw new NotFoundError(
        "Esta loja não possui um turno de caixa aberto.",
        "TURNO_NAO_ENCONTRADO"
      )
    }

    return this.caixaRepository.fechar({
      id: turno.id,
      fechado_por_id: usuarioId,
      valor_fechamento: data.valor_fechamento,
    })
  }

  /**
   * Consulta do turno aberto. O frontend usa para saber se pode vender, e o
   * módulo de venda (#50) vai consumir internamente — a venda exige turno
   * aberto.
   */
  async buscarAberto(estabelecimentoId: string): Promise<TurnoComRelacoes> {
    const turno = await this.caixaRepository.findAbertoByEstabelecimento(estabelecimentoId)

    if (!turno) {
      throw new NotFoundError(
        "Esta loja não possui um turno de caixa aberto.",
        "TURNO_NAO_ENCONTRADO"
      )
    }

    return turno
  }
}
