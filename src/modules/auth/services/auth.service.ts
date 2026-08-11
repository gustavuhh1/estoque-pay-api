import { AuthRepository } from "../repositories/auth.repository.js"

export class AuthService {
  constructor(private authRepository = new AuthRepository()) {}

  async execute() {
    // Regras de negócio de autenticação
    return { status: "auth_service_ok" }
  }
}
