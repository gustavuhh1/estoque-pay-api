/**
 * Funções utilitárias globais compartilhadas entre os módulos.
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

/** Remove a máscara do CNPJ: `11.222.333/0001-81` -> `11222333000181`. */
export function sanitizeCnpj(value: string): string {
  return value.replace(/\D/g, "")
}

/** Pesos do módulo 11 da Receita para o 1º e o 2º dígito verificador. */
const CNPJ_DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const CNPJ_DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

function checkDigit(digits: number[], weights: number[]): number {
  const sum = weights.reduce(
    (acc, weight, index) => acc + weight * (digits[index] ?? 0),
    0
  )
  const rest = sum % 11

  return rest < 2 ? 0 : 11 - rest
}

/**
 * Valida um CNPJ (com ou sem máscara) pelos dois dígitos verificadores.
 *
 * Sequências repetidas (`11111111111111`) passam na conta do módulo 11, mas não
 * existem na Receita — são o típico placeholder digitado em formulário, então
 * entram como caso especial de rejeição.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = sanitizeCnpj(value)

  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const digits = cnpj.split("").map(Number)

  return (
    digits[12] === checkDigit(digits, CNPJ_DV1_WEIGHTS) &&
    digits[13] === checkDigit(digits, CNPJ_DV2_WEIGHTS)
  )
}
