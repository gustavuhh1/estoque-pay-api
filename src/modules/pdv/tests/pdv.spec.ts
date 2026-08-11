import { describe, expect, it } from "vitest"
import { PdvService } from "../services/pdv.service.js"

describe("PDV Module - Unit Tests", () => {
  it("deve executar o serviço de PDV com sucesso", async () => {
    const pdvService = new PdvService()
    const response = await pdvService.execute()

    expect(response).toEqual({ status: "pdv_service_ok" })
  })
})
