import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { CategoriaController } from "./controller/CategoriaController"
import { CategoriaService } from "./service/CategoriaService"
import { CategoriaPrismaRepository } from "./repository/CategoriaPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  categoriaParamsSchema,
  categoriaResponseSchema,
  createCategoriaSchema,
  listCategoriasResponseSchema,
  produtoIdsSchema,
  updateCategoriaSchema,
} from "./dto/categoria.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (mesmo padrão do módulo Produto).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function categoriaRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositório (Infrastructure)
  const categoriaRepository = new CategoriaPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const categoriaService = new CategoriaService(categoriaRepository)

  // 3. Instanciar Controller (Presentation)
  const categoriaController = new CategoriaController(categoriaService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Cria uma categoria na loja ativa",
        description: `RF07.1. ${TENANT_HEADER_DOC} Opcionalmente já vincula produtos existentes da loja via \`produto_ids\` (RF11.5). Caixa (CASHIER) não pode criar categorias.`,
        security: [{ cookieAuth: [] }],
        body: createCategoriaSchema,
        response: {
          201: categoriaResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
          404: errorResponseSchema.describe(
            "Algum produto_id informado não pertence a esta loja (code: PRODUTO_NAO_ENCONTRADO)"
          ),
          409: errorResponseSchema.describe(
            "Nome de categoria já cadastrado nesta loja (code: CATEGORIA_NOME_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.create(req, res)
  )

  route.get(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Lista as categorias da loja ativa",
        description: `RF08.2. ${TENANT_HEADER_DOC} Cada categoria inclui os produtos vinculados (id + nome). Caixa (CASHIER) não tem acesso a esta rota de gestão.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: listCategoriasResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.list(req, res)
  )

  route.patch(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Edita o nome de uma categoria",
        description: `RF09.3. ${TENANT_HEADER_DOC} Só o nome — o vínculo com produtos tem rotas próprias (POST/DELETE /:id/produtos, RF11.5).`,
        security: [{ cookieAuth: [] }],
        params: categoriaParamsSchema,
        body: updateCategoriaSchema,
        response: {
          200: categoriaResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
          404: errorResponseSchema.describe(
            "Categoria não encontrada nesta loja (code: NOT_FOUND)"
          ),
          409: errorResponseSchema.describe(
            "Nome já usado por outra categoria desta loja (code: CATEGORIA_NOME_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.update(req, res)
  )

  route.post(
    "/:id/produtos",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Adiciona produtos ao vínculo N:N da categoria",
        description: `RF11.5. ${TENANT_HEADER_DOC} Incremental (Prisma \`connect\`): só adiciona os produtos informados, sem afetar os demais já vinculados.`,
        security: [{ cookieAuth: [] }],
        params: categoriaParamsSchema,
        body: produtoIdsSchema,
        response: {
          200: categoriaResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
          404: errorResponseSchema.describe(
            "Categoria não encontrada nesta loja (code: NOT_FOUND) ou produto_id inválido (code: PRODUTO_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.addProdutos(req, res)
  )

  route.delete(
    "/:id/produtos",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Remove produtos do vínculo N:N da categoria",
        description: `RF11.5 / RN08. ${TENANT_HEADER_DOC} Incremental (Prisma \`disconnect\`): só remove o vínculo dos produtos informados — nunca apaga o Produto em si, nem afeta os demais vínculos da categoria.`,
        security: [{ cookieAuth: [] }],
        params: categoriaParamsSchema,
        body: produtoIdsSchema,
        response: {
          200: categoriaResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
          404: errorResponseSchema.describe(
            "Categoria não encontrada nesta loja (code: NOT_FOUND) ou produto_id inválido (code: PRODUTO_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.removeProdutos(req, res)
  )

  route.delete(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Categoria"],
        summary: "Exclui uma categoria da loja ativa",
        description: `RF10.4. ${TENANT_HEADER_DOC} RN02/RN08: exclusão desimpedida mesmo com produtos vinculados — remove só a "etiqueta" (o vínculo N:N), os produtos permanecem intactos no estoque.`,
        security: [{ cookieAuth: [] }],
        params: categoriaParamsSchema,
        response: {
          // 204 não declara schema de propósito (mesmo padrão do DELETE /produto/:id).
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CATEGORIAS)"
          ),
          404: errorResponseSchema.describe(
            "Categoria não encontrada nesta loja (code: NOT_FOUND)"
          ),
        },
      },
    },
    async (req, res) => categoriaController.delete(req, res)
  )
}
