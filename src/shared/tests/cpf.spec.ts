import { describe, it, expect } from "vitest"
import { isValidCpf, sanitizeCpf } from "@/shared/utils"

describe("sanitizeCpf", () => {
  it("Deve remover a máscara e devolver apenas os dígitos", () => {
    expect(sanitizeCpf("529.982.247-25")).toBe("52998224725")
  })

  it("Deve devolver o valor intacto quando já vem sem máscara", () => {
    expect(sanitizeCpf("52998224725")).toBe("52998224725")
  })

  it("Deve descartar espaços e qualquer caractere não numérico", () => {
    expect(sanitizeCpf(" 529 982 247-25 ")).toBe("52998224725")
  })
})

describe("isValidCpf", () => {
  it("Deve aceitar um CPF válido sem máscara", () => {
    expect(isValidCpf("52998224725")).toBe(true)
  })

  it("Deve aceitar o mesmo CPF válido com máscara", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true)
  })

  it("Deve rejeitar CPF com menos de 11 dígitos", () => {
    expect(isValidCpf("5299822472")).toBe(false)
  })

  it("Deve rejeitar CPF com mais de 11 dígitos", () => {
    expect(isValidCpf("529982247250")).toBe(false)
  })

  it("Deve rejeitar sequências de dígitos repetidos", () => {
    // Passam na conta dos dígitos verificadores, mas não existem na Receita.
    expect(isValidCpf("11111111111")).toBe(false)
    expect(isValidCpf("00000000000")).toBe(false)
  })

  it("Deve rejeitar CPF com o segundo dígito verificador errado", () => {
    expect(isValidCpf("52998224726")).toBe(false)
  })

  it("Deve rejeitar CPF com o primeiro dígito verificador errado", () => {
    expect(isValidCpf("52998224715")).toBe(false)
  })

  it("Deve rejeitar string vazia", () => {
    expect(isValidCpf("")).toBe(false)
  })
})
