import { describe, expect, it } from "vitest"
import { NfceService } from "../services/nfce.service.js"

describe("NFC-e Module - Unit Tests", () => {
  it("deve executar o serviço de NFC-e com sucesso", async () => {
    const nfceService = new NfceService()
    const response = await nfceService.execute()

    expect(response).toEqual({ status: "nfce_service_ok" })
  })
})
