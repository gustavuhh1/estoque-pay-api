import { EstoqueRepository } from "../repositories/estoque.repository.js"

export class EstoqueService {
  constructor(private estoqueRepository = new EstoqueRepository()) {}

  async execute() {
    // Regra de negócio de estoque, produtos, categorias e alertas
    return { status: "estoque_service_ok" }
  }
}
