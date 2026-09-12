import { describe, it, expect } from "vitest"
import { isValidCnpj, sanitizeCnpj } from "@/shared/utils"

describe("sanitizeCnpj", () => {
  it("Deve remover a máscara e devolver apenas os dígitos", () => {
    expect(sanitizeCnpj("11.222.333/0001-81")).toBe("11222333000181")
  })

  it("Deve devolver o valor intacto quando já vem sem máscara", () => {
    expect(sanitizeCnpj("11222333000181")).toBe("11222333000181")
  })

  it("Deve descartar espaços e qualquer caractere não numérico", () => {
    expect(sanitizeCnpj(" 11 222 333/0001-81 ")).toBe("11222333000181")
  })
})

describe("isValidCnpj", () => {
  it("Deve aceitar um CNPJ válido sem máscara", () => {
    expect(isValidCnpj("11222333000181")).toBe(true)
  })

  it("Deve aceitar o mesmo CNPJ válido com máscara", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true)
  })

  it("Deve rejeitar CNPJ com menos de 14 dígitos", () => {
    expect(isValidCnpj("1122233300018")).toBe(false)
  })

  it("Deve rejeitar CNPJ com mais de 14 dígitos", () => {
    expect(isValidCnpj("112223330001811")).toBe(false)
  })

  it("Deve rejeitar sequências de dígitos repetidos", () => {
    // Passam na conta dos dígitos verificadores, mas não existem na Receita.
    expect(isValidCnpj("11111111111111")).toBe(false)
    expect(isValidCnpj("00000000000000")).toBe(false)
  })

  it("Deve rejeitar CNPJ com o segundo dígito verificador errado", () => {
    expect(isValidCnpj("11222333000182")).toBe(false)
  })

  it("Deve rejeitar CNPJ com o primeiro dígito verificador errado", () => {
    expect(isValidCnpj("11222333000191")).toBe(false)
  })

  it("Deve rejeitar string vazia", () => {
    expect(isValidCnpj("")).toBe(false)
  })
})
