import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { ClienteController } from "./controller/ClienteController"
import { CupomController } from "./controller/CupomController"
import { ClienteService } from "./service/ClienteService"
import { CupomService } from "./service/CupomService"
import { ClientePrismaRepository } from "./repository/ClientePrismaRepository"
import { CupomPrismaRepository } from "./repository/CupomPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  clienteParamsSchema,
  clienteResponseSchema,
  createClienteSchema,
  estatisticasQuerySchema,
  estatisticasResponseSchema,
  listClientesQuerySchema,
  listClientesResponseSchema,
  listComprasQuerySchema,
  listComprasResponseSchema,
  updateClienteSchema,
} from "./dto/cliente.dto"
import {
  createCupomSchema,
  cupomResponseSchema,
  listCuponsQuerySchema,
  listCuponsResponseSchema,
} from "./dto/cupom.dto"

/**
 * Todas as rotas deste módulo são tenant-scoped: precisam do header
 * `x-estabelecimento-id` (mesmo padrão dos módulos Produto/Estoque).
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function crmRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const clienteRepository = new ClientePrismaRepository(prisma)

  const cupomRepository = new CupomPrismaRepository(prisma)

  // 2. Instanciar Services (Application)
  const clienteService = new ClienteService(clienteRepository)
  const cupomService = new CupomService(cupomRepository, clienteRepository)

  // 3. Instanciar Controllers (Presentation)
  const clienteController = new ClienteController(clienteService)
  const cupomController = new CupomController(cupomService)

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

  route.get(
    "/clientes/:id/compras",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Histórico de compras do cliente",
        description: `RF02.1 (#58). ${TENANT_HEADER_DOC} As vendas indexadas ao cliente — o vínculo é feito automaticamente quando o \`POST /pagamento\` recebe o \`cliente_id\`. Mais recentes primeiro, paginado (\`page\`, \`limit\` — padrão 20, máximo 100). Vendas canceladas continuam no histórico, com \`status_pagamento: CANCELADO\`.`,
        security: [{ cookieAuth: [] }],
        params: clienteParamsSchema,
        querystring: listComprasQuerySchema,
        response: {
          200: listComprasResponseSchema,
          400: errorResponseSchema.describe("Query inválida ou header de tenant ausente"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
          404: errorResponseSchema.describe(
            "Cliente não encontrado nesta loja (code: CLIENTE_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => clienteController.listarCompras(req, res)
  )

  route.get(
    "/clientes/:id/estatisticas",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Inteligência de dados do cliente: consumo e produtos favoritos",
        description: `RF02.2 (#58). ${TENANT_HEADER_DOC} Considera só vendas **PAGAS** (cancelada foi estornada; Pix pendente nunca foi pago). Devolve total de compras, valor gasto, ticket médio, primeira/última compra e os \`top\` produtos favoritos (padrão 5, máximo 20), ordenados pelo número de vezes em que apareceram nas compras — a soma das quantidades só desempata, porque somar kg com unidade não indica preferência.`,
        security: [{ cookieAuth: [] }],
        params: clienteParamsSchema,
        querystring: estatisticasQuerySchema,
        response: {
          200: estatisticasResponseSchema,
          400: errorResponseSchema.describe("Query inválida ou header de tenant ausente"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
          404: errorResponseSchema.describe(
            "Cliente não encontrado nesta loja (code: CLIENTE_NAO_ENCONTRADO)"
          ),
        },
      },
    },
    async (req, res) => clienteController.estatisticas(req, res)
  )

  route.post(
    "/cupons",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Emite um cupom de fidelidade",
        description: `RF02.3 (#58). ${TENANT_HEADER_DOC} Com \`cliente_id\`, o cupom é **nominal** e só pode ser resgatado numa venda desse cliente; sem ele, é um cupom genérico da loja. \`codigo\` é opcional (o sistema gera um no formato \`FID-XXXX-XXXX\`), único por loja e gravado em maiúsculas. \`expira_em\` é opcional (sem ele, o cupom não expira). O **resgate** acontece no \`POST /pagamento\`, pelo \`cupom_codigo\`. Caixa (CASHIER) não emite cupons.`,
        security: [{ cookieAuth: [] }],
        body: createCupomSchema,
        response: {
          201: cupomResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_CUPONS)"
          ),
          404: errorResponseSchema.describe(
            "Cliente não encontrado nesta loja (code: CLIENTE_NAO_ENCONTRADO)"
          ),
          409: errorResponseSchema.describe(
            "Código já usado nesta loja (code: CUPOM_CODIGO_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => cupomController.create(req, res)
  )

  route.get(
    "/cupons",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["CRM"],
        summary: "Lista os cupons da loja",
        description: `RF02.3 (#58). ${TENANT_HEADER_DOC} Mais recentes primeiro. Filtre pelos cupons de um cliente com \`cliente_id\`. Cada cupom vem com o \`status\` derivado: DISPONIVEL, RESGATADO ou EXPIRADO. Qualquer cargo consulta (o Caixa precisa ver os cupons do cliente no balcão).`,
        security: [{ cookieAuth: [] }],
        querystring: listCuponsQuerySchema,
        response: {
          200: listCuponsResponseSchema,
          400: errorResponseSchema.describe("Query inválida ou header de tenant ausente"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe("Sem vínculo com a loja (code: TENANT_ACCESS_DENIED)"),
        },
      },
    },
    async (req, res) => cupomController.list(req, res)
  )
}
