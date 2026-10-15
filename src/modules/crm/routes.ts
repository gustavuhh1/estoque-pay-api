import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { ClienteController } from "./controller/ClienteController"
import { ClienteService } from "./service/ClienteService"
import { ClientePrismaRepository } from "./repository/ClientePrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  clienteParamsSchema,
  clienteResponseSchema,
  createClienteSchema,
  listClientesQuerySchema,
  listClientesResponseSchema,
  updateClienteSchema,
} from "./dto/cliente.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (mesmo padrão dos módulos Produto/Estoque).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function crmRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const clienteRepository = new ClientePrismaRepository(prisma)

  // 2. Instanciar Services (Application)
  const clienteService = new ClienteService(clienteRepository)

  // 3. Instanciar Controllers (Presentation)
  const clienteController = new ClienteController(clienteService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/clientes",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Cadastra um cliente na loja ativa",
        description: `RF01.1. ${TENANT_HEADER_DOC} CPF e nome são obrigatórios; telefone, data de nascimento (\`AAAA-MM-DD\`) e observação são opcionais. O CPF é aceito com ou sem máscara (é normalizado antes de gravar), validado pelos dígitos verificadores e único **por loja** — a mesma pessoa pode ser cliente de várias lojas. Qualquer cargo pode cadastrar, inclusive Caixa (é quem identifica o cliente no balcão).`,
        security: [{ cookieAuth: [] }],
        body: createClienteSchema,
        response: {
          201: clienteResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos, inclusive CPF inválido (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
          409: errorResponseSchema.describe(
            "CPF já cadastrado nesta loja (code: CLIENTE_CPF_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => clienteController.create(req, res)
  )

  route.get(
    "/clientes",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Lista os clientes da loja ativa",
        description: `RF01.2. ${TENANT_HEADER_DOC} Paginado (\`page\`, \`limit\` — padrão 20, máximo 100) e em ordem alfabética. \`busca\` casa parcialmente no nome ou pelo início do CPF (com ou sem máscara). Parâmetros não usados devem ser OMITIDOS — mandar vazio (ex: \`?busca=\`) é erro de validação.`,
        security: [{ cookieAuth: [] }],
        querystring: listClientesQuerySchema,
        response: {
          200: listClientesResponseSchema,
          400: errorResponseSchema.describe(
            "Query inválida (code: VALIDATION_ERROR) ou header de tenant ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
        },
      },
    },
    async (req, res) => clienteController.list(req, res)
  )

  route.get(
    "/clientes/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Detalha um cliente da loja ativa",
        description: `RF01.3. ${TENANT_HEADER_DOC} Cliente de outra loja responde 404, igual a inexistente.`,
        security: [{ cookieAuth: [] }],
        params: clienteParamsSchema,
        response: {
          200: clienteResponseSchema,
          400: errorResponseSchema.describe("Id inválido ou header de tenant ausente"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
          404: errorResponseSchema.describe(
            "Cliente não encontrado nesta loja (code: CLIENTE_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => clienteController.findById(req, res)
  )

  route.patch(
    "/clientes/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Atualiza os dados cadastrais de um cliente",
        description: `RF01.4. ${TENANT_HEADER_DOC} Atualização parcial: envie só o que muda. Telefone, data de nascimento e observação aceitam \`null\` para limpar o campo. Trocar o CPF passa pela mesma validação e pela mesma trava de duplicidade do cadastro.`,
        security: [{ cookieAuth: [] }],
        params: clienteParamsSchema,
        body: updateClienteSchema,
        response: {
          200: clienteResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos ou body vazio (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
          404: errorResponseSchema.describe(
            "Cliente não encontrado nesta loja (code: CLIENTE_NAO_ENCONTRADO)"
          ),
          409: errorResponseSchema.describe(
            "CPF já cadastrado em outro cliente desta loja (code: CLIENTE_CPF_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => clienteController.update(req, res)
  )
}
