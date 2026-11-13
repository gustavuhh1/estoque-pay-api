import { randomInt } from "node:crypto"
import { Prisma, type Cupom, type Role } from "../../../../generated/prisma/client.js"
import {
  CupomCodigoAlreadyInUseError,
  CupomDeOutroClienteError,
  CupomDesativadoError,
  CupomExigeClienteError,
  CupomExpiradoError,
  CupomJaResgatadoError,
  CupomJaUsadoPeloClienteError,
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

/** Cupom pronto para entrar na venda: o próprio cupom e o CPF de quem está usando. */
export type CupomParaResgate = { cupom: Cupom; cliente_id: string; cpf: string }

/** RF02.3 — issue #58: emissão, listagem, gestão e validação de resgate de cupons. */
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
        tipo_desconto: data.tipo_desconto ?? "VALOR",
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
  async list(estabelecimentoId: string, query: ListCuponsQuery) {
    return this.cupomRepository.findManyByEstabelecimento(estabelecimentoId, query)
  }

  private async buscarDaLoja(id: string, estabelecimentoId: string) {
    const cupom = await this.cupomRepository.findByIdAndEstabelecimento(id, estabelecimentoId)
    if (!cupom) throw new NotFoundError("Cupom não encontrado nesta loja.", "CUPOM_NAO_ENCONTRADO")
    return cupom
  }

  /** O dono encerra o cupom antes da validade. Os usos já feitos continuam no histórico. */
  async desativar(id: string, estabelecimentoId: string, role: Role) {
    this.garantirAcessoEmissao(role)
    await this.buscarDaLoja(id, estabelecimentoId)
    return this.cupomRepository.desativar(id)
  }

  /** Quem usou o cupom, quando e quanto abateu. Gestão: mesmo cargo de quem emite. */
  async usos(id: string, estabelecimentoId: string, role: Role) {
    this.garantirAcessoEmissao(role)
    await this.buscarDaLoja(id, estabelecimentoId)
    return this.cupomRepository.findUsos(id)
  }

  /**
   * Checagens de resgate feitas ANTES de abrir a transação da venda, para o
   * caixa receber o motivo certo (expirado, de outro cliente...). As travas
   * contra resgate duplo simultâneo NÃO são estas: são o `updateMany`
   * condicional (individual) e o unique (cupom, cpf) de cupom_usos (global),
   * dentro da transação da venda (ver VendaPrismaRepository).
   *
   * Todo uso precisa de cliente identificado: o individual porque é nominal,
   * o global porque a regra é "1 uso por CPF".
   */
  async validarParaResgate(
    estabelecimentoId: string,
    codigo: string,
    clienteId: string | undefined
  ): Promise<CupomParaResgate> {
    const cupom = await this.cupomRepository.findByCodigo(estabelecimentoId, codigo)

    if (!cupom) {
      throw new NotFoundError("Cupom não encontrado nesta loja.", "CUPOM_NAO_ENCONTRADO")
    }

    if (cupom.desativado_em) {
      throw new CupomDesativadoError()
    }

    if (cupom.resgatado_em) {
      throw new CupomJaResgatadoError()
    }

    if (cupom.expira_em && cupom.expira_em <= new Date()) {
      throw new CupomExpiradoError(cupom.expira_em)
    }

    // Cupom individual só vale na venda do próprio dono.
    if (cupom.cliente_id && cupom.cliente_id !== clienteId) {
      throw new CupomDeOutroClienteError()
    }

    if (!clienteId) {
      throw new CupomExigeClienteError()
    }

    const cliente = await this.clienteRepository.findByIdAndEstabelecimento(clienteId, estabelecimentoId)

    if (!cliente) {
      throw new NotFoundError("Cliente não encontrado nesta loja.", "CLIENTE_NAO_ENCONTRADO")
    }

    if (await this.cupomRepository.existsUso(cupom.id, cliente.cpf)) {
      throw cupom.cliente_id ? new CupomJaResgatadoError() : new CupomJaUsadoPeloClienteError()
    }

    return { cupom, cliente_id: cliente.id, cpf: cliente.cpf }
  }
}
