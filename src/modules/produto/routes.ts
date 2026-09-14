import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { ProdutoController } from "./controller/ProdutoController"
import { ProdutoService } from "./service/ProdutoService"
import { ProdutoPrismaRepository } from "./repository/ProdutoPrismaRepository"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  createProdutoSchema,
  listProdutosResponseSchema,
  produtoParamsSchema,
  produtoResponseSchema,
  updateProdutoSchema,
} from "./dto/produto.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (ver o mesmo comentário em estabelecimento/routes.ts
 * sobre por que ele NUNCA é declarado como `schema.headers` do Fastify).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function produtoRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const produtoRepository = new ProdutoPrismaRepository(prisma)
  const estabelecimentoRepository = new EstabelecimentoPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const produtoService = new ProdutoService(produtoRepository, estabelecimentoRepository)

  // 3. Instanciar Controller (Presentation)
  const produtoController = new ProdutoController(produtoService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Cria um produto na loja ativa",
        description: `RF01.1. ${TENANT_HEADER_DOC} Se a loja tiver o switch de NFC-e ligado e faltar NCM ou CFOP, o produto é salvo mesmo assim, mas nasce com ativo=false (RN09.1 — nunca bloqueia o cadastro, só evita venda fora de conformidade). Caixa (CASHIER) não pode criar produtos.`,
        security: [{ cookieAuth: [] }],
        body: createProdutoSchema,
        response: {
          201: produtoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS)"
          ),
          409: errorResponseSchema.describe(
            "Código de barras já cadastrado nesta loja (code: EAN_GTIN_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => produtoController.create(req, res)
  )

  route.get(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Lista os produtos da loja ativa",
        description: `RF02.2. ${TENANT_HEADER_DOC} Inclui produtos inativos (ativo=false); produtos excluídos não aparecem. Caixa (CASHIER) não tem acesso a esta rota de gestão.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: listProdutosResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS)"
          ),
        },
      },
    },
    async (req, res) => produtoController.list(req, res)
  )

  route.patch(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Edita os dados de um produto da loja ativa",
        description: `RF03.3. ${TENANT_HEADER_DOC} Reaplica a RN09.1 no save: se remover NCM/CFOP com NFC-e ligada, força ativo=false automaticamente. Não aceita alterar "ativo" diretamente — use /inativar ou /reativar.`,
        security: [{ cookieAuth: [] }],
        params: produtoParamsSchema,
        body: updateProdutoSchema,
        response: {
          200: produtoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS)"
          ),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: NOT_FOUND)"
          ),
          409: errorResponseSchema.describe(
            "Código de barras já usado por outro produto desta loja (code: EAN_GTIN_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => produtoController.update(req, res)
  )

  route.delete(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Exclui um produto da loja ativa",
        description: `RF04.4. ${TENANT_HEADER_DOC} Se o produto nunca foi vendido, a exclusão é permanente (e apaga também seu histórico de movimentação de estoque). Se já tem venda registrada, o produto é ocultado (soft delete) para preservar o histórico financeiro — de fora, o efeito é o mesmo: o produto some da loja.`,
        security: [{ cookieAuth: [] }],
        params: produtoParamsSchema,
        response: {
          // 204 (sucesso) não declara schema de propósito: não há corpo, e o
          // serializerCompiler do @fastify/type-provider-zod exige um Zod
          // schema de verdade em toda entrada declarada (um JSON Schema cru
          // tipo `{ type: "null" }` quebra a compilação da rota).
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS)"
          ),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: NOT_FOUND)"
          ),
        },
      },
    },
    async (req, res) => produtoController.delete(req, res)
  )

  route.patch(
    "/:id/inativar",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Inativa um produto (some do PDV, mantém o histórico)",
        description: `RF05.5. ${TENANT_HEADER_DOC} Sempre permitido, sem trava fiscal — a trava fica só na reativação (RN09.2).`,
        security: [{ cookieAuth: [] }],
        params: produtoParamsSchema,
        response: {
          200: produtoResponseSchema,
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS)"
          ),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: NOT_FOUND)"
          ),
        },
      },
    },
    async (req, res) => produtoController.inativar(req, res)
  )

  route.patch(
    "/:id/reativar",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Produto"],
        summary: "Reativa um produto, sujeito à trava de conformidade fiscal",
        description: `RF06.6. ${TENANT_HEADER_DOC} RN09.2: bloqueado se a loja tiver NFC-e ligada e o produto não tiver NCM/CFOP preenchidos.`,
        security: [{ cookieAuth: [] }],
        params: produtoParamsSchema,
        response: {
          200: produtoResponseSchema,
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED), cargo sem permissão (code: ROLE_CANNOT_MANAGE_PRODUCTS), ou trava fiscal (code: PRODUTO_SEM_CONFORMIDADE_FISCAL)"
          ),
          404: errorResponseSchema.describe(
            "Produto não encontrado nesta loja (code: NOT_FOUND)"
          ),
        },
      },
    },
    async (req, res) => produtoController.reativar(req, res)
  )
}
