import { describe, it, expect } from "vitest"
import { planoEfetivo } from "@/shared/utils"

describe("planoEfetivo (RN00 — plano derivado da assinatura)", () => {
  it("Deve ser PREMIUM em trial e com a assinatura ativa", () => {
    expect(planoEfetivo("TRIALING")).toBe("PREMIUM")
    expect(planoEfetivo("ACTIVE")).toBe("PREMIUM")
  })

  it("Deve cair para FREE em inadimplência e cancelamento", () => {
    expect(planoEfetivo("PAST_DUE")).toBe("FREE")
    expect(planoEfetivo("CANCELED")).toBe("FREE")
  })

  it("Deve ser FREE quando a loja não tem assinatura", () => {
    expect(planoEfetivo(null)).toBe("FREE")
    expect(planoEfetivo(undefined)).toBe("FREE")
  })
})
