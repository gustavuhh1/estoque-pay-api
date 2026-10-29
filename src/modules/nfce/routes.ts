import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "@fastify/type-provider-zod"
import { NfceController } from "./controller/NfceController"
import { criarNfceService } from "./service/criarNfceService"
import { requireAuth } from "@/shared/middlewares/require-auth"
import { requireTenant } from "@/shared/middlewares/require-tenant"
import { errorResponseSchema } from "@/shared/errors/schema"
import {
  listNotasQuerySchema,
  listNotasResponseSchema,
  notaResponseSchema,
  vendaIdParamsSchema,
} from "./dto/nfce.dto"
import { AVISO_SIMULACAO } from "./espelho"

const TENANT_HEADER_DOC = "Requer o header `x-estabelecimento-id` (UUID da loja ativa)."
const SIMULACAO_DOC = `**${AVISO_SIMULACAO}.** Não há emissão real, nem integração com a SEFAZ.`

/**
 * NFC-e SIMULADA (D3, issue #81). Qualquer cargo consulta e imprime (o Caixa
 * entrega a via no balcão); reemitir é de Owner/Gestor.
 */
export async function nfceRoutes(app: FastifyInstance) {
  const nfceController = new NfceController(criarNfceService())

  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    "/",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["NFC-e (simulada)"],
        summary: "Lista as NFC-e simuladas da loja ativa",
        description: `${TENANT_HEADER_DOC} ${SIMULACAO_DOC} Da mais nova para a mais antiga, paginada (\`limit\` padrão 20, máximo 100). Só as notas desta loja. Cada item traz \`simulada: true\` e o \`aviso\`. A nota emitida continua listada mesmo que a loja seja rebaixada ou desligue o Switch Fiscal depois.`,
        security: [{ cookieAuth: [] }],
        querystring: listNotasQuerySchema,
        response: {
          200: listNotasResponseSchema,
          400: errorResponseSchema.describe("Header ausente ou parâmetros inválidos"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
        },
      },
    },
    async (req, res) => nfceController.listar(req, res)
  )

  route.get(
    "/vendas/:venda_id",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["NFC-e (simulada)"],
        summary: "Consulta a NFC-e simulada de uma venda",
        description: `${TENANT_HEADER_DOC} ${SIMULACAO_DOC} Devolve o retrato da nota: loja, itens, desconto, **a linha da taxa de R$ 0,80 quando a venda foi Pix**, forma de pagamento e o consumidor (CPF ou "Consumidor Não Identificado"). A chave de acesso é **fictícia** (começa com \`SIMULADO\`). Nota de outra loja é 404.`,
        security: [{ cookieAuth: [] }],
        params: vendaIdParamsSchema,
        response: {
          200: notaResponseSchema,
          400: errorResponseSchema.describe("Header ausente ou id inválido"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
          404: errorResponseSchema.describe("Sem nota nesta loja (code: NFCE_NAO_ENCONTRADA)"),
        },
      },
    },
    async (req, res) => nfceController.consultar(req, res)
  )

  route.get(
    "/vendas/:venda_id/imprimir",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["NFC-e (simulada)"],
        summary: "Versão imprimível (HTML) da NFC-e simulada",
        description: `${TENANT_HEADER_DOC} ${SIMULACAO_DOC} Devolve \`text/html\` autocontido, pronto para \`window.print()\`. O aviso de simulação aparece no topo, no rodapé e como marca d'água. O HTML é gerado a cada leitura a partir do retrato guardado, então o aviso nunca depende de um documento antigo. Servido com \`Content-Security-Policy\` restritiva.`,
        security: [{ cookieAuth: [] }],
        params: vendaIdParamsSchema,
        response: {
          400: errorResponseSchema.describe("Header ausente ou id inválido"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe("Sem vínculo com esta loja"),
          404: errorResponseSchema.describe("Sem nota nesta loja (code: NFCE_NAO_ENCONTRADA)"),
        },
      },
    },
    async (req, res) => nfceController.imprimir(req, res)
  )

  route.post(
    "/vendas/:venda_id/emitir",
    {
      preHandler: [requireAuth, requireTenant],
      schema: {
        tags: ["NFC-e (simulada)"],
        summary: "Emite (ou reemite) a NFC-e simulada de uma venda paga",
        description: `${TENANT_HEADER_DOC} ${SIMULACAO_DOC} A nota é emitida **sozinha** quando a venda é paga; esta rota é para a que ficou em ERRO, ou para a venda paga antes de o Switch ser ligado. **Idempotente**: se a nota já existe, devolve a existente (200) sem gastar número. Só Owner e Gestor (Caixa 403). Exige venda **paga**, Switch Fiscal **ligado** e plano **Premium** (409 \`NFCE_NAO_ELEGIVEL\` com o \`motivo\`).`,
        security: [{ cookieAuth: [] }],
        params: vendaIdParamsSchema,
        response: {
          200: notaResponseSchema.describe("A nota já existia"),
          201: notaResponseSchema.describe("Nota emitida agora"),
          400: errorResponseSchema.describe("Header ausente ou id inválido"),
          401: errorResponseSchema.describe("Sessão ausente ou inválida"),
          403: errorResponseSchema.describe(
            "Sem vínculo com a loja ou Caixa (code: ROLE_CANNOT_EMIT_NFCE)"
          ),
          404: errorResponseSchema.describe("Venda inexistente nesta loja (code: VENDA_NAO_ENCONTRADA)"),
          409: errorResponseSchema.describe(
            "Venda sem direito a nota (code: NFCE_NAO_ELEGIVEL; details.motivo: VENDA_NAO_PAGA | SWITCH_DESLIGADO | PLANO_FREE)"
          ),
        },
      },
    },
    async (req, res) => nfceController.emitir(req, res)
  )
}
