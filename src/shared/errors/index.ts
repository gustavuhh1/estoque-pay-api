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
