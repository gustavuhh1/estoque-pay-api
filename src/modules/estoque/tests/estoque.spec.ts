import { describe, expect, it } from "vitest"
import { EstoqueService } from "../services/estoque.service.js"

describe("Estoque Module - Unit Tests", () => {
  it("deve executar o serviço de estoque com sucesso", async () => {
    const estoqueService = new EstoqueService()
    const response = await estoqueService.execute()

    expect(response).toEqual({ status: "estoque_service_ok" })
  })
})
