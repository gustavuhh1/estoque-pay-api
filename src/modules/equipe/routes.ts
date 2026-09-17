import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { EquipeController } from "./controller/EquipeController"
import { EquipeService } from "./service/EquipeService"
import { EquipePrismaRepository } from "./repository/EquipePrismaRepository"
import { ConvitePrismaRepository } from "./repository/ConvitePrismaRepository"
import { AuthPrismaRepository } from "@/modules/auth/repository/AuthPrismaRepository"
import { EstabelecimentoPrismaRepository } from "@/modules/estabelecimento/repository/EstabelecimentoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  createFuncionarioSchema,
  funcionarioParamsSchema,
  funcionarioResponseSchema,
  conviteResponseSchema,
  listEquipeResponseSchema,
  updateFuncionarioSchema,
} from "./dto/equipe.dto"

/** Ver o mesmo comentário em estabelecimento/routes.ts sobre por que este header nunca é `schema.headers`. */
const TENANT_HEADER_DOC = "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function equipeRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositórios (Infrastructure)
  const equipeRepository = new EquipePrismaRepository(prisma)
  const conviteRepository = new ConvitePrismaRepository(prisma)
  const authRepository = new AuthPrismaRepository(prisma)
  const estabelecimentoRepository = new EstabelecimentoPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const equipeService = new EquipeService(
    equipeRepository,
    conviteRepository,
    authRepository,
    estabelecimentoRepository
  )

  // 3. Instanciar Controller (Presentation)
  const equipeController = new EquipeController(equipeService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Equipe"],
        summary: "Cadastra um funcionário na loja ativa",
        description: `RF05.1 + RN01. ${TENANT_HEADER_DOC} Se o e-mail já tiver conta na plataforma, o vínculo é criado na hora (201, sem nenhum e-mail disparado — vínculo silencioso). Se não tiver, fica um convite pendente e um e-mail avisa a pessoa a se cadastrar (202) — o vínculo acontece sozinho quando ela completar o cadastro. Caixa não pode cadastrar; Gestor só pode atribuir o cargo Caixa (só o Owner atribui Gestor/Owner).`,
        security: [{ cookieAuth: [] }],
        body: createFuncionarioSchema,
        response: {
          201: funcionarioResponseSchema.describe("Vínculo criado direto (usuário já tinha conta)"),
          202: conviteResponseSchema.describe("Convite pendente criado (usuário ainda não tinha conta)"),
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED), cargo sem permissão (code: ROLE_CANNOT_MANAGE_EQUIPE), ou Gestor tentando atribuir cargo além de Caixa (code: ROLE_CANNOT_ASSIGN_ROLE)"
          ),
          409: errorResponseSchema.describe(
            "Usuário já faz parte da equipe desta loja (code: FUNCIONARIO_JA_VINCULADO)"
          ),
        },
      },
    },
    async (req, res) => equipeController.cadastrar(req, res)
  )

  route.get(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Equipe"],
        summary: "Lista a equipe da loja ativa",
        description: `RF05.2. ${TENANT_HEADER_DOC} Inclui os membros vinculados e os convites ainda pendentes de aceite. Caixa não tem acesso a esta rota.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: listEquipeResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo sem permissão (code: ROLE_CANNOT_MANAGE_EQUIPE)"
          ),
        },
      },
    },
    async (req, res) => equipeController.listar(req, res)
  )

  route.patch(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Equipe"],
        summary: "Edita o cargo de um funcionário da loja ativa",
        description: `RF05.3 + RN02. ${TENANT_HEADER_DOC} Gestor não pode editar um Owner, nem atribuir cargo além de Caixa. Rebaixar o último Owner da loja também é bloqueado (mesma trava de RN03).`,
        security: [{ cookieAuth: [] }],
        params: funcionarioParamsSchema,
        body: updateFuncionarioSchema,
        response: {
          200: funcionarioResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED), cargo sem permissão (code: ROLE_CANNOT_MANAGE_EQUIPE | ROLE_CANNOT_EDIT_OWNER | ROLE_CANNOT_ASSIGN_ROLE), ou tentativa de rebaixar o último Owner (code: LAST_OWNER_CANNOT_BE_REMOVED)"
          ),
          404: errorResponseSchema.describe("Funcionário não encontrado nesta loja (code: NOT_FOUND)"),
        },
      },
    },
    async (req, res) => equipeController.editar(req, res)
  )

  route.delete(
    "/:id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Equipe"],
        summary: "Remove o acesso de um funcionário à loja ativa",
        description: `RF05.4 + RN02 + RN03 + RN06. ${TENANT_HEADER_DOC} Gestor não pode excluir um Owner. Não é possível excluir o último Owner da loja. A sessão do funcionário removido é derrubada imediatamente (RN06) — vale para todas as lojas dele, já que a sessão não é por-loja.`,
        security: [{ cookieAuth: [] }],
        params: funcionarioParamsSchema,
        response: {
          // 204 sem schema de propósito — mesmo motivo documentado em produto/routes.ts.
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED), cargo sem permissão (code: ROLE_CANNOT_MANAGE_EQUIPE | ROLE_CANNOT_EDIT_OWNER), ou último Owner da loja (code: LAST_OWNER_CANNOT_BE_REMOVED)"
          ),
          404: errorResponseSchema.describe("Funcionário não encontrado nesta loja (code: NOT_FOUND)"),
        },
      },
    },
    async (req, res) => equipeController.excluir(req, res)
  )
}
