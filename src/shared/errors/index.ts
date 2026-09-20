/**
 * Erros de aplicação com status HTTP associado.
 * Capturados pelo errorHandler, que traduz o statusCode na resposta.
 *
 * `code` é o contrato estável com o consumidor da API: o front faz `switch` nele,
 * nunca no texto de `message` (que pode mudar/ser traduzido a qualquer momento).
 * `details` carrega contexto opcional — ex: qual campo do formulário falhou.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  // `| undefined` explícito por causa do exactOptionalPropertyTypes do tsconfig.
  readonly details?: Record<string, unknown> | undefined

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = new.target.name
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = "Requisição inválida.",
    code = "BAD_REQUEST",
    details?: Record<string, unknown>
  ) {
    super(message, 400, code, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Credenciais inválidas", code = "UNAUTHORIZED") {
    super(message, 401, code)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acesso negado.", code = "FORBIDDEN") {
    super(message, 403, code)
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso não encontrado.", code = "NOT_FOUND") {
    super(message, 404, code)
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "Recurso já existente.",
    code = "CONFLICT",
    details?: Record<string, unknown>
  ) {
    super(message, 409, code, details)
  }
}

/**
 * Conflito específico de cadastro: e-mail já em uso.
 * Código próprio (em vez do genérico CONFLICT) para o cliente conseguir
 * destacar o campo e oferecer "esqueci minha senha" sem parsear texto.
 */
export class EmailAlreadyInUseError extends ConflictError {
  constructor(message = "Este e-mail já está cadastrado.") {
    super(message, "EMAIL_ALREADY_IN_USE", { field: "email" })
  }
}

/**
 * Conflito de onboarding: o CNPJ é único na plataforma inteira, não por usuário.
 * Código próprio para o cliente destacar o campo e orientar quem tenta cadastrar
 * uma loja que já existe (o caminho certo é pedir convite ao dono, não recriar).
 */
export class CnpjAlreadyInUseError extends ConflictError {
  constructor(message = "Este CNPJ já está cadastrado na plataforma.") {
    super(message, "CNPJ_ALREADY_IN_USE", { field: "cnpj" })
  }
}

/**
 * Conflito de cadastro de produto: o código de barras (EAN/GTIN) é único por
 * loja (não na plataforma inteira, ao contrário do CNPJ — cada estabelecimento
 * tem seu próprio catálogo).
 */
export class EanGtinAlreadyInUseError extends ConflictError {
  constructor(message = "Já existe um produto com este código de barras nesta loja.") {
    super(message, "EAN_GTIN_ALREADY_IN_USE", { field: "ean_gtin" })
  }
}

/**
 * Conflito de cadastro de categoria: o nome é único por loja (não na
 * plataforma inteira), mesmo padrão do ean_gtin em Produto.
 */
export class CategoriaNomeAlreadyInUseError extends ConflictError {
  constructor(message = "Já existe uma categoria com este nome nesta loja.") {
    super(message, "CATEGORIA_NOME_ALREADY_IN_USE", { field: "nome" })
  }
}

/**
 * Tentativa de cancelar uma venda que já foi cancelada. 409 porque o corpo da
 * requisição está correto — o conflito é com o estado atual da venda.
 *
 * Existe para o cancelamento ser idempotente do ponto de vista do estoque: sem
 * esta trava, cancelar duas vezes devolveria o produto ao estoque em dobro e
 * criaria mercadoria do nada.
 */
export class VendaJaCanceladaError extends ConflictError {
  constructor(message = "Esta venda já foi cancelada.") {
    super(message, "VENDA_JA_CANCELADA")
  }
}

/**
 * Tentativa de cancelar uma venda que nunca foi paga (ex: Pix PENDENTE que o
 * cliente abandonou). Não há o que estornar, e devolver ao estoque criaria
 * saldo do nada — a baixa nunca aconteceu.
 */
export class VendaNaoPagaError extends ConflictError {
  constructor(status: string) {
    super(
      `Só é possível cancelar uma venda paga. Status atual: ${status}.`,
      "VENDA_NAO_PAGA",
      { status_atual: status }
    )
  }
}

/**
 * Tentativa de vender sem turno de caixa aberto na loja.
 *
 * É 409 e não 403: não é falta de permissão, é conflito com o estado atual da
 * loja — basta alguém abrir o caixa e a mesma requisição passa. O fechamento de
 * caixa só consegue apontar furo se TODA venda estiver amarrada a um turno,
 * então vender fora de turno é bloqueado de propósito.
 */
export class TurnoFechadoError extends ConflictError {
  constructor(
    message = "Não é possível vender com o caixa fechado. Abra o turno antes."
  ) {
    super(message, "TURNO_FECHADO")
  }
}

/**
 * Pagamento em dinheiro menor que o total da venda. 400 porque o problema está
 * no corpo da requisição em si, não em estado do banco.
 */
export class ValorPagoInsuficienteError extends BadRequestError {
  constructor(total: number, valorPago: number) {
    super(
      `Valor pago (${valorPago}) é menor que o total da venda (${total}).`,
      "VALOR_PAGO_INSUFICIENTE",
      { field: "valor_pago", total, valor_pago: valorPago }
    )
  }
}

/**
 * Tentativa de abrir turno numa loja que já tem um turno ABERTO. O turno é por
 * LOJA, não por pessoa — enquanto o caixa da loja estiver aberto, ninguém abre
 * outro, seja quem for.
 *
 * O Service checa antes para dar este erro de forma amigável, mas também
 * converte o P2002 do índice único parcial `turnos_caixa_um_aberto_por_loja`:
 * dois cliques simultâneos passariam os dois pela checagem prévia, e nesse caso
 * é o banco que barra o segundo.
 */
export class TurnoJaAbertoError extends ConflictError {
  constructor(
    message = "Esta loja já possui um turno de caixa aberto. Feche o turno atual antes de abrir outro."
  ) {
    super(message, "TURNO_JA_ABERTO")
  }
}

/**
 * Saída manual maior que o saldo em estoque. É 409 (e não 400) porque o corpo
 * da requisição está bem formado — o conflito é com o estado atual do produto,
 * que pode mudar a qualquer momento. `details` leva o saldo para o cliente
 * conseguir dizer "você só tem 2.5 kg" sem uma segunda chamada.
 */
export class EstoqueInsuficienteError extends ConflictError {
  constructor(saldoAtual: number, solicitado: number) {
    super(
      `Estoque insuficiente: saldo atual de ${saldoAtual}, solicitado ${solicitado}.`,
      "ESTOQUE_INSUFICIENTE",
      { field: "quantidade", saldo_atual: saldoAtual, solicitado }
    )
  }
}
