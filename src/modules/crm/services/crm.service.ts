import { CrmRepository } from "../repositories/crm.repository.js"

export class CrmService {
  constructor(private crmRepository = new CrmRepository()) {}

  async execute() {
    // Regra de negócio de CRM e inteligência de clientes
    return { status: "crm_service_ok" }
  }
}
