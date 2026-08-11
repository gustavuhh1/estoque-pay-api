import { NfceRepository } from "../repositories/nfce.repository.js"

export class NfceService {
  constructor(private nfceRepository = new NfceRepository()) {}

  async execute() {
    // Regra de negócio da emissão invisível de notas fiscais (NFC-e)
    return { status: "nfce_service_ok" }
  }
}
