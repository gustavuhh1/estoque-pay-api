import { describe, expect, it } from "vitest"
import { AuthService } from "../services/auth.service.js"

describe("Auth Module - Unit Tests", () => {
  it("deve executar o serviço de autenticação com sucesso", async () => {
    const authService = new AuthService()
    const response = await authService.execute()

    expect(response).toEqual({ status: "auth_service_ok" })
  })
})
