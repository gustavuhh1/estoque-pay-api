import { PdvRepository } from "../repositories/pdv.repository.js"

export class PdvService {
  constructor(private pdvRepository = new PdvRepository()) {}

  async execute() {
    // Regra de negócio do PDV (carrinho, cálculo de troco, turnos)
    return { status: "pdv_service_ok" }
  }
}
