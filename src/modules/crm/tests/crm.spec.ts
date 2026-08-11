import { describe, expect, it } from "vitest"
import { CrmService } from "../services/crm.service.js"

describe("CRM Module - Unit Tests", () => {
  it("deve executar o serviço de CRM com sucesso", async () => {
    const crmService = new CrmService()
    const response = await crmService.execute()

    expect(response).toEqual({ status: "crm_service_ok" })
  })
})
