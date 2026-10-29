/**
 * Cria (ou atualiza) as lojas Premium de teste usadas na validação em produção
 * (Etapa 7, cenários 14, 15 e 16). Não existe checkout real em modo dev para o
 * avaliador, então o estado da assinatura é gravado direto no banco, o mesmo que
 * o webhook da AbacatePay produziria.
 *
 * É idempotente: rodar de novo recoloca as três lojas no estado de partida
 * (útil depois de gastar o trial ou de testar a inadimplência).
 *
 * Uso (aponta para o banco do `DATABASE_URL` do ambiente):
 *   npx tsx scripts/premium-teste.ts --confirmar
 */
import "dotenv/config"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { StatusAssinatura } from "../generated/prisma/client.js"

const EMAIL = "premium-teste@exemplo.com"
const SENHA = "Premium@teste123"
const DIA = 24 * 60 * 60 * 1000

type Cenario = {
  nome: string
  cnpj: string
  status: StatusAssinatura
  emite_nfce: boolean
  trial_dias: number | null
  periodo_dias: number
}

// Estados de partida de cada cenário. Na inadimplência o webhook desliga o switch
// fiscal (AssinaturaService, `desligar_nfce`), então a loja já nasce assim.
const CENARIOS: Cenario[] = [
  {
    nome: "Loja Premium Trial (cenário 14)",
    cnpj: "11444777000161",
    status: "TRIALING",
    emite_nfce: true,
    trial_dias: 7,
    periodo_dias: 7,
  },
  {
    nome: "Loja Premium Inadimplente (cenário 15)",
    cnpj: cnpjValido("30000001"),
    status: "PAST_DUE",
    emite_nfce: false,
    trial_dias: null,
    periodo_dias: -1,
  },
  {
    nome: "Loja Premium Ativa (cenário 16)",
    cnpj: cnpjValido("30000002"),
    status: "ACTIVE",
    emite_nfce: true,
    trial_dias: null,
    periodo_dias: 30,
  },
]

/** Completa os 8 dígitos-base + filial 0001 com os dois dígitos verificadores. */
function cnpjValido(base: string): string {
  const digitos = `${base}0001`.split("").map(Number)
  const dv = (parcial: number[]) => {
    const pesos = parcial.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = parcial.reduce((acc, n, i) => acc + n * (pesos[i] ?? 0), 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d1 = dv(digitos)
  const d2 = dv([...digitos, d1])
  return [...digitos, d1, d2].join("")
}

async function garantirUsuario() {
  const existente = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (existente) return existente

  await auth.api.signUpEmail({ body: { email: EMAIL, password: SENHA, name: "Dono Premium de Teste" } })
  return prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
}

async function main() {
  if (!process.argv.includes("--confirmar")) {
    const host = new URL(process.env["DATABASE_URL"] ?? "postgresql://?").host
    console.error(`Vai gravar no banco ${host}. Rode de novo com --confirmar.`)
    process.exit(1)
  }

  const user = await garantirUsuario()
  const agora = Date.now()

  for (const c of CENARIOS) {
    const loja = await prisma.estabelecimento.upsert({
      where: { cnpj: c.cnpj },
      create: { nome: c.nome, cnpj: c.cnpj, emite_nfce: c.emite_nfce },
      update: { nome: c.nome, emite_nfce: c.emite_nfce },
    })

    await prisma.membroEstabelecimento.upsert({
      where: { userId_estabelecimentoId: { userId: user.id, estabelecimentoId: loja.id } },
      create: { userId: user.id, estabelecimentoId: loja.id, role: "OWNER" },
      update: { role: "OWNER" },
    })

    const dados = {
      status: c.status,
      tipo_plano: "MENSAL" as const,
      trial_expira_em: c.trial_dias === null ? null : new Date(agora + c.trial_dias * DIA),
      periodo_atual_fim: new Date(agora + c.periodo_dias * DIA),
    }
    await prisma.assinatura.upsert({
      where: { estabelecimento_id: loja.id },
      create: { estabelecimento_id: loja.id, ...dados },
      update: dados,
    })

    console.log(`${c.status.padEnd(9)} ${loja.id}  ${c.nome}`)
  }

  console.log(`\nLogin: ${EMAIL} / ${SENHA}`)
}

main()
  .catch((erro) => {
    console.error(erro)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
