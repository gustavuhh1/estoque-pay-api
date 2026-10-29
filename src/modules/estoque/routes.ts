import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { EstoqueController } from "./controller/EstoqueController"
import { EstoqueService } from "./service/EstoqueService"
import { EstoquePrismaRepository } from "./repository/EstoquePrismaRepository"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  createMovimentacaoSchema,
  listAlertasResponseSchema,
  listMovimentacoesQuerySchema,
  listMovimentacoesResponseSchema,
  movimentacaoResponseSchema,
} from "./dto/estoque.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (mesmo padrão dos módulos Produto/Categoria).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function estoqueRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const estoqueRepository = new EstoquePrismaRepository(prisma)
  const produtoRepository = new ProdutoPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const estoqueService = new EstoqueService(estoqueRepository, produtoRepository)

  // 3. Instanciar Controller (Presentation)
  const estoqueController = new EstoqueController(estoqueService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/movimentacao",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estoque"],
        summary: "Lança uma entrada ou saída manual de estoque",
        description: `RF12.1/RF13.2/RF14.3. ${TENANT_HEADER_DOC} O motivo é obrigatório e precisa ser coerente com o tipo: REABASTECIMENTO só em ENTRADA; DESCARTE, PERDA e VENCIMENTO só em SAIDA; AJUSTE_MANUAL nos dois. VENDA e ESTORNO_VENDA não são aceitos aqui (são escritos pelo PDV). A quantidade aceita até 3 casas decimais (RN04). O saldo do produto e o registro de auditoria são gravados na mesma transação (RN05). Caixa (CASHIER) não pode movimentar estoque.`,
        security: [{ cookieAuth: [] }],
        body: createMovimentacaoSchema,
        response: {
          201: movimentacaoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos, motivo incoerente com o tipo ou header de tenant ausente (code: VALIDATION_ERROR / TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_ESTOQUE)"
          ),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: PRODUTO_NAO_ENCONTRADO)"
          ),
          409: errorResponseSchema.describe(
            "Saída maior que o saldo em estoque (code: ESTOQUE_INSUFICIENTE)"
          ),
        },
      },
    },
    async (req, res) => estoqueController.registrarMovimentacao(req, res)
  )

  route.get(
    "/movimentacoes",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estoque"],
        summary: "Relatório de auditoria das movimentações de estoque",
        description: `RF15.4 + RN05. ${TENANT_HEADER_DOC} Devolve o histórico imutável da loja em ordem cronológica decrescente, com o nome do produto e do usuário responsável. Filtre por produto com \`produto_id\`. Parâmetros não usados devem ser OMITIDOS — mandar vazio (ex: \`?page=\`) é erro de validação. Caixa (CASHIER) não tem acesso.`,
        security: [{ cookieAuth: [] }],
        querystring: listMovimentacoesQuerySchema,
        response: {
          200: listMovimentacoesResponseSchema,
          400: errorResponseSchema.describe(
            "Query inválida (code: VALIDATION_ERROR) ou header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_ESTOQUE)"
          ),
        },
      },
    },
    async (req, res) => estoqueController.listMovimentacoes(req, res)
  )

  route.get(
    "/alertas",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estoque"],
        summary: "Lista os produtos com estoque no nível mínimo ou abaixo",
        description: `RF16.1/RF17.2. ${TENANT_HEADER_DOC} Devolve só os produtos em que \`quantidade_atual <= quantidade_minima\`, já excluindo inativos e excluídos. Consulta feita para alimentar o dashboard. Caixa (CASHIER) não tem acesso.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: listAlertasResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_ESTOQUE)"
          ),
        },
      },
    },
    async (req, res) => estoqueController.listAlertas(req, res)
  )
}
