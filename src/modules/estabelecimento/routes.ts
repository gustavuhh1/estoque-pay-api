import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { EstabelecimentoController } from "./controller/EstabelecimentoController"
import { SwitchFiscalController } from "./controller/SwitchFiscalController"
import { EstabelecimentoService } from "./service/EstabelecimentoService"
import { SwitchFiscalService } from "./service/SwitchFiscalService"
import { EstabelecimentoPrismaRepository } from "./repository/EstabelecimentoPrismaRepository"
import { ProdutoPrismaRepository } from "@/modules/produto/repository/ProdutoPrismaRepository"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  createEstabelecimentoSchema,
  createEstabelecimentoResponseSchema,
  listEstabelecimentosResponseSchema,
  estabelecimentoAtivoResponseSchema,
  estabelecimentoResponseSchema,
  preCheckFiscalResponseSchema,
  switchFiscalSchema,
  updateEstabelecimentoSchema,
} from "./dto/estabelecimento.dto"

/**
 * NÃO declarar `headers` no schema Zod da rota para documentar isto: o
 * @fastify/type-provider-zod devolve `{ value }` do parse, e o Fastify faz
 * `request.headers = value` com o resultado — como o Zod descarta chaves
 * desconhecidas por padrão, isso apagaria o cookie de sessão de
 * `request.headers` ANTES do requireAuth rodar (a validação de schema roda
 * no preValidation, antes do preHandler). O header fica documentado só em
 * prosa na `description` de cada rota; quem valida de verdade é o
 * requireTenant.
 */
const TENANT_HEADER_DOC =
  "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."

export async function estabelecimentoRoutes(app: FastifyInstance) {
  // 1. Instanciar Repositório (Infrastructure)
  const estabelecimentoRepository = new EstabelecimentoPrismaRepository(prisma)

  // 2. Instanciar Service (Application)
  const estabelecimentoService = new EstabelecimentoService(
    estabelecimentoRepository
  )

  const switchFiscalService = new SwitchFiscalService(
    estabelecimentoRepository,
    new ProdutoPrismaRepository(prisma)
  )

  // 3. Instanciar Controller (Presentation)
  const estabelecimentoController = new EstabelecimentoController(
    estabelecimentoService
  )
  const switchFiscalController = new SwitchFiscalController(switchFiscalService)

  // 4. Registrar Rotas
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Cria um estabelecimento e vincula o criador como OWNER",
        description:
          "RF02.1 e RF02.2: a loja e o vínculo do dono são gravados na mesma transação. O CNPJ é único na plataforma e aceito com ou sem máscara (é normalizado antes de gravar).",
        security: [{ cookieAuth: [] }],
        body: createEstabelecimentoSchema,
        response: {
          201: createEstabelecimentoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          409: errorResponseSchema.describe(
            "CNPJ já cadastrado (code: CNPJ_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => estabelecimentoController.create(req, res)
  )

  route.get(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Lista as lojas em que o usuário autenticado tem vínculo",
        description: "RF03.1: cada item vem com o cargo do usuário naquela loja.",
        security: [{ cookieAuth: [] }],
        response: {
          200: listEstabelecimentosResponseSchema,
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
        },
      },
    },
    async (req, res) => estabelecimentoController.list(req, res)
  )

  route.get(
    "/ativo",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Retorna os dados completos da loja ativa",
        description: `RF03.2 e RF04.1 (leitura). ${TENANT_HEADER_DOC} Qualquer cargo com vínculo pode ler (inclusive Caixa — precisa saber em qual loja está operando no PDV).`,
        security: [{ cookieAuth: [] }],
        response: {
          200: estabelecimentoAtivoResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo com a loja informada (code: TENANT_ACCESS_DENIED)"
          ),
        },
      },
    },
    async (req, res) => estabelecimentoController.getAtivo(req, res)
  )

  route.patch(
    "/ativo",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Atualiza os dados cadastrais da loja ativa",
        description: `RF04.1 (escrita) e RF04.2. ${TENANT_HEADER_DOC} Gestor (MANAGER) não pode alterar campos críticos (cnpj, certificado_a1, certificado_a1_senha) — só o Owner. Caixa (CASHIER) não edita nada aqui.`,
        security: [{ cookieAuth: [] }],
        body: updateEstabelecimentoSchema,
        response: {
          200: estabelecimentoResponseSchema,
          400: errorResponseSchema.describe(
            "Dados inválidos (code: VALIDATION_ERROR)"
          ),
          401: errorResponseSchema.describe(
            "Sessão ausente ou inválida (code: UNAUTHORIZED)"
          ),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED), ou cargo sem permissão para o campo (code: ROLE_CANNOT_EDIT_STORE | CRITICAL_FIELD_FORBIDDEN)"
          ),
          409: errorResponseSchema.describe(
            "CNPJ já cadastrado em outra loja (code: CNPJ_ALREADY_IN_USE)"
          ),
        },
      },
    },
    async (req, res) => estabelecimentoController.updateAtivo(req, res)
  )

  route.get(
    "/ativo/nfce/pre-check",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Pre-check de conformidade para emitir NFC-e",
        description: `RN01/RN01.1 (#59). ${TENANT_HEADER_DOC} Só consulta, não liga nada: devolve \`apto\` e **todas** as pendências de uma vez — plano Premium (derivado da assinatura), Certificado A1 com senha, Inscrição Estadual e produtos ativos sem NCM/CFOP (com uma amostra de até 50 deles). Owner e Gestor consultam; Caixa não.`,
        security: [{ cookieAuth: [] }],
        response: {
          200: preCheckFiscalResponseSchema,
          400: errorResponseSchema.describe(
            "Header x-estabelecimento-id ausente (code: TENANT_HEADER_REQUIRED)"
          ),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo Caixa (code: ROLE_CANNOT_MANAGE_NFCE)"
          ),
        },
      },
    },
    async (req, res) => switchFiscalController.preCheck(req, res)
  )

  route.patch(
    "/ativo/nfce",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["Estabelecimento"],
        summary: "Liga ou desliga o Switch Fiscal (emissão de NFC-e)",
        description: `RN01/RN01.1 (#59). ${TENANT_HEADER_DOC} **Ligar** (\`emite_nfce: true\`) roda o mesmo pre-check do \`GET /ativo/nfce/pre-check\` e só passa com tudo em ordem; senão responde 409 com a lista completa em \`details.pendencias\`. **Desligar** é sempre permitido. Com o switch ligado, produtos sem NCM/CFOP passam a nascer inativos (RN09.1) e não podem ser reativados (RN09.2). Só o Owner altera o switch.`,
        security: [{ cookieAuth: [] }],
        body: switchFiscalSchema,
        response: {
          200: estabelecimentoResponseSchema,
          400: errorResponseSchema.describe("Dados inválidos (code: VALIDATION_ERROR)"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida (code: UNAUTHORIZED)"),
          403: errorResponseSchema.describe(
            "Sem vínculo (code: TENANT_ACCESS_DENIED) ou cargo que não é Owner (code: ROLE_CANNOT_MANAGE_NFCE)"
          ),
          409: errorResponseSchema.describe(
            "Pre-check reprovado (code: NFCE_PRE_CHECK_REPROVADO), com `details.pendencias`"
          ),
        },
      },
    },
    async (req, res) => switchFiscalController.alterar(req, res)
  )
}
