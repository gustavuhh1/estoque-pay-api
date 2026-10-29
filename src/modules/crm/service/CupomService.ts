import { randomInt } from "node:crypto"
import { Prisma, type Cupom, type Role } from "../../../../generated/prisma/client.js"
import {
  CupomCodigoAlreadyInUseError,
  CupomDeOutroClienteError,
  CupomExpiradoError,
  CupomJaResgatadoError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors"
import type { CreateCupomDTO, ListCuponsQuery } from "../dto/cupom.dto"
import type { IClienteRepository } from "../repository/IClienteRepository"
import type { ICupomRepository } from "../repository/ICupomRepository"

/** Sem 0/O e 1/I: o código é lido em voz alta e digitado no balcão. */
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function gerarCodigo(): string {
  const sorteio = (tamanho: number) =>
    Array.from({ length: tamanho }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join("")

  return `FID-${sorteio(4)}-${sorteio(4)}`
}

/** RF02.3 — issue #58: emissão, listagem e validação de resgate de cupons. */
export class CupomService {
  constructor(
    private cupomRepository: ICupomRepository,
    private clienteRepository: IClienteRepository
  ) {}

  /**
   * Emitir cupom é dar desconto: decisão de Gestor/Owner, não do Caixa. O
   * RESGATE não passa por aqui — acontece no pagamento, que o Caixa faz.
   */
  private garantirAcessoEmissao(role: Role) {
    if (role === "CASHIER") {
      throw new ForbiddenError(
        "Usuários com o cargo Caixa não podem emitir cupons.",
        "ROLE_CANNOT_MANAGE_CUPONS"
      )
    }
  }

  async create(estabelecimentoId: string, role: Role, data: CreateCupomDTO): Promise<Cupom> {
    this.garantirAcessoEmissao(role)

    if (
      data.cliente_id &&
      !(await this.clienteRepository.findByIdAndEstabelecimento(data.cliente_id, estabelecimentoId))
    ) {
      throw new NotFoundError("Cliente não encontrado nesta loja.", "CLIENTE_NAO_ENCONTRADO")
    }

    const codigo = data.codigo ?? gerarCodigo()

    if (await this.cupomRepository.existsCodigo(estabelecimentoId, codigo)) {
      throw new CupomCodigoAlreadyInUseError()
    }

    try {
      return await this.cupomRepository.create({
        estabelecimento_id: estabelecimentoId,
        cliente_id: data.cliente_id,
        codigo,
        valor_desconto: data.valor_desconto,
        expira_em: data.expira_em,
      })
    } catch (error) {
      // Corrida entre o pré-check e o insert: o unique (loja, código) decide.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CupomCodigoAlreadyInUseError()
      }

      throw error
    }
  }

  /** Sem trava de cargo: o Caixa precisa ver os cupons do cliente no balcão. */
  async list(estabelecimentoId: string, query: ListCuponsQuery): Promise<Cupom[]> {
    return this.cupomRepository.findManyByEstabelecimento(estabelecimentoId, query)
  }

  /**
   * Checagens de resgate feitas ANTES de abrir a transação da venda, para o
   * caixa receber o motivo certo (expirado, de outro cliente...). A trava
   * contra resgate duplo simultâneo NÃO é esta: é o `updateMany` condicional
   * dentro da transação da venda (ver VendaPrismaRepository).
   */
  async validarParaResgate(
    estabelecimentoId: string,
    codigo: string,
    clienteId: string | undefined
  ): Promise<Cupom> {
    const cupom = await this.cupomRepository.findByCodigo(estabelecimentoId, codigo)

    if (!cupom) {
      throw new NotFoundError("Cupom não encontrado nesta loja.", "CUPOM_NAO_ENCONTRADO")
    }

    if (cupom.resgatado_em) {
      throw new CupomJaResgatadoError()
    }

    if (cupom.expira_em && cupom.expira_em <= new Date()) {
      throw new CupomExpiradoError(cupom.expira_em)
    }

    // Cupom nominal só vale na venda do próprio dono. Cupom genérico
    // (cliente_id null) vale para qualquer venda, com ou sem cliente.
    if (cupom.cliente_id && cupom.cliente_id !== clienteId) {
      throw new CupomDeOutroClienteError()
    }

    return cupom
  }
}
