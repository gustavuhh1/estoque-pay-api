/**
 * Seed de apresentação do EstoquePay: alimenta o banco com a loja "Mercadinho Ponto Certo" (plano Free, equipe,
 * produtos, clientes, caixa aberto, vendas e cupom) e as três lojas Premium de teste (trial, inadimplente e ativa).
 * Substitui o antigo scripts/premium-teste.ts e o seed-demo.mjs do front.
 *
 * Uso:
 *   npm run seed                      alimenta o banco do DATABASE_URL (local); repetível, não duplica nada
 *   npm run seed -- --reset           APAGA todos os dados (mantém o schema e as migrações) e alimenta de novo
 *   npm run seed -- --prod            usa o PROD_DATABASE_URL (produção) em vez do DATABASE_URL
 *   npm run seed -- --prod --reset    zera e recria a produção
 *
 * Com --prod o script pede para digitar o nome do banco antes de gravar; --yes pula essa confirmação.
 * O PROD_DATABASE_URL fica só no .env local e precisa ser o endereço EXTERNO do banco (o interno da Render só
 * resolve dentro da rede dela).
 */
import "dotenv/config"
import { createInterface } from "node:readline/promises"

const args = new Set(process.argv.slice(2))
const RESET = args.has("--reset")
const PROD = args.has("--prod")
const YES = args.has("--yes")

const SENHA_APRESENTACAO = "Apresenta@2026"
const SENHA_PREMIUM = "Premium@teste123"
const DIA = 24 * 60 * 60 * 1000
const HORA = 60 * 60 * 1000

const PRODUTOS: [nome: string, categoria: string, tipo: "UNIDADE" | "FRACIONADO_KG", custo: number, venda: number, estoque: number, minimo: number][] = [
  ["Café Torrado 500g", "Mercearia", "UNIDADE", 11.0, 18.9, 4, 10],
  ["Arroz Branco 5kg", "Mercearia", "UNIDADE", 20.0, 27.9, 40, 10],
  ["Feijão Carioca 1kg", "Mercearia", "UNIDADE", 6.0, 8.9, 55, 12],
  ["Açúcar Refinado 1kg", "Mercearia", "UNIDADE", 3.4, 4.99, 60, 12],
  ["Óleo de Soja 900ml", "Mercearia", "UNIDADE", 5.5, 7.49, 48, 10],
  ["Biscoito Recheado 140g", "Mercearia", "UNIDADE", 2.5, 3.99, 70, 15],
  ["Leite Integral 1L", "Laticínios e Frios", "UNIDADE", 3.6, 5.49, 6, 12],
  ["Queijo Mussarela (kg)", "Laticínios e Frios", "FRACIONADO_KG", 30.0, 42.0, 8.5, 2],
  ["Presunto Fatiado (kg)", "Laticínios e Frios", "FRACIONADO_KG", 25.0, 36.0, 6, 2],
  ["Refrigerante 2L", "Bebidas", "UNIDADE", 6.2, 9.9, 36, 12],
  ["Água Mineral 500ml", "Bebidas", "UNIDADE", 1.0, 2.5, 120, 24],
  ["Sabão em Pó 1kg", "Limpeza", "UNIDADE", 9.0, 12.9, 30, 8],
  ["Detergente 500ml", "Limpeza", "UNIDADE", 1.7, 2.99, 80, 15],
  ["Banana Prata (kg)", "Hortifruti", "FRACIONADO_KG", 4.0, 6.9, 25, 5],
  ["Pão Francês (kg)", "Padaria", "FRACIONADO_KG", 8.0, 14.9, 15, 4],
]

const CLIENTES = [
  ["Marina Duarte", "48211933020"],
  ["Ricardo Alves", "12877420175"],
  ["Juliana Paz", "90322187001"],
  ["Carlos Santos", "52998224725"],
] as const

type Metodo = "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX_ABACATEPAY"
type VendaSeed = { itens: [string, number][]; metodo: Metodo; cliente?: string; horasAtras: number; cancelar?: boolean }

const VENDAS: VendaSeed[] = [
  { itens: [["Arroz Branco 5kg", 1], ["Feijão Carioca 1kg", 2], ["Óleo de Soja 900ml", 1]], metodo: "DINHEIRO", cliente: "Marina Duarte", horasAtras: 5 },
  { itens: [["Refrigerante 2L", 2], ["Biscoito Recheado 140g", 3]], metodo: "DEBITO", horasAtras: 4 },
  { itens: [["Queijo Mussarela (kg)", 0.35], ["Presunto Fatiado (kg)", 0.25], ["Pão Francês (kg)", 0.5]], metodo: "CREDITO", cliente: "Ricardo Alves", horasAtras: 3 },
  { itens: [["Água Mineral 500ml", 6], ["Detergente 500ml", 2]], metodo: "DINHEIRO", horasAtras: 2 },
  { itens: [["Sabão em Pó 1kg", 1]], metodo: "DEBITO", horasAtras: 1.5, cancelar: true },
  { itens: [["Banana Prata (kg)", 1.2], ["Açúcar Refinado 1kg", 2]], metodo: "PIX_ABACATEPAY", cliente: "Marina Duarte", horasAtras: 1 },
]

/** Taxa do Pix paga pelo consumidor (D1). */
const TAXA_PIX = 0.8

type Premium = {
  nome: string
  cnpj: string
  status: "TRIALING" | "ACTIVE" | "PAST_DUE"
  emite_nfce: boolean
  trial_dias: number | null
  periodo_dias: number
  fiscal: boolean
  produtos?: { nome: string; ean_gtin: string; custo: number; venda: number; estoque: number; ncm: string; cfop: string }[]
}

// Dados fictícios: a emissão é simulada (D3), nada disto é validado pela SEFAZ.
const FISCAL = { ie: "123456789110", certificado_a1: "certificados/premium-teste.pfx", certificado_a1_senha: "senha-simulada" }

const PREMIUM: Premium[] = [
  { nome: "Loja Premium Trial (cenário 14)", cnpj: "11444777000161", status: "TRIALING", emite_nfce: true, trial_dias: 7, periodo_dias: 7, fiscal: true },
  { nome: "Loja Premium Inadimplente (cenário 15)", cnpj: cnpjValido("30000001"), status: "PAST_DUE", emite_nfce: false, trial_dias: null, periodo_dias: -1, fiscal: false },
  {
    nome: "Loja Premium Ativa (cenário 16)",
    cnpj: cnpjValido("30000002"),
    status: "ACTIVE",
    emite_nfce: true,
    trial_dias: null,
    periodo_dias: 30,
    fiscal: true,
    produtos: [
      { nome: "Arroz Tipo 1 5kg", ean_gtin: "7891000100103", custo: 22, venda: 29.9, estoque: 50, ncm: "10063021", cfop: "5102" },
      { nome: "Feijão Carioca 1kg", ean_gtin: "7891000200202", custo: 6.5, venda: 9.9, estoque: 80, ncm: "07133319", cfop: "5102" },
      { nome: "Refrigerante Cola 2L", ean_gtin: "7891000300301", custo: 5.2, venda: 8.5, estoque: 120, ncm: "22021000", cfop: "5405" },
    ],
  },
]

/** Completa os 8 dígitos-base + filial 0001 com os dois dígitos verificadores. */
function cnpjValido(base: string): string {
  const digitos = `${base}0001`.split("").map(Number)
  const dv = (parcial: number[]) => {
    const pesos = parcial.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const resto = parcial.reduce((acc, n, i) => acc + n * (pesos[i] ?? 0), 0) % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d1 = dv(digitos)
  return [...digitos, d1, dv([...digitos, d1])].join("")
}

const centavos = (valor: number) => Math.round(valor * 100) / 100

async function confirmar(url: string) {
  const { host, pathname } = new URL(url)
  const banco = pathname.replace(/^\//, "")
  console.log(`Banco: ${host}/${banco}${RESET ? "  (TODOS OS DADOS SERÃO APAGADOS)" : ""}`)
  if (!PROD || YES) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const digitado = await rl.question(`Isto é PRODUÇÃO. Digite o nome do banco (${banco}) para continuar: `)
  rl.close()
  if (digitado.trim() !== banco) {
    console.error("Nome diferente: nada foi feito.")
    process.exit(1)
  }
}

async function main() {
  const url = PROD ? process.env["PROD_DATABASE_URL"] : process.env["DATABASE_URL"]
  if (!url) {
    console.error(PROD ? "Defina PROD_DATABASE_URL no .env (endereço externo do banco de produção)." : "Defina DATABASE_URL no .env.")
    process.exit(1)
  }
  await confirmar(url)
  // O cliente Prisma e o Better Auth leem o DATABASE_URL ao serem importados: troca antes do import.
  process.env["DATABASE_URL"] = url
  const { prisma } = await import("@/lib/prisma")
  const { auth } = await import("@/lib/auth")

  try {
    if (RESET) {
      const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
      if (tabelas.length) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`)
      }
      console.log(`Reset: ${tabelas.length} tabelas esvaziadas.`)
    }

    async function usuario(email: string, name: string, password: string) {
      const existente = await prisma.user.findUnique({ where: { email } })
      if (existente) return existente
      await auth.api.signUpEmail({ body: { email, password, name } })
      return prisma.user.findUniqueOrThrow({ where: { email } })
    }

    async function vincular(userId: string, estabelecimentoId: string, role: "OWNER" | "MANAGER" | "CASHIER") {
      await prisma.membroEstabelecimento.upsert({
        where: { userId_estabelecimentoId: { userId, estabelecimentoId } },
        create: { userId, estabelecimentoId, role },
        update: { role },
      })
    }

    // ── Loja de apresentação (plano Free) ──────────────────────────────────
    const dono = await usuario("apresentacao@exemplo.com", "Carlos Santos", SENHA_APRESENTACAO)
    const gestor = await usuario("gestor-apresentacao@exemplo.com", "Ana Lima", SENHA_APRESENTACAO)
    const caixa = await usuario("caixa-apresentacao@exemplo.com", "Mário Enrique", SENHA_APRESENTACAO)

    const loja = await prisma.estabelecimento.upsert({
      where: { cnpj: "55443322000105" },
      create: { nome: "Mercadinho Ponto Certo", cnpj: "55443322000105", ie: "082114550119" },
      update: {},
    })
    await vincular(dono.id, loja.id, "OWNER")
    await vincular(gestor.id, loja.id, "MANAGER")
    await vincular(caixa.id, loja.id, "CASHIER")

    const categorias = new Map<string, string>()
    for (const nome of new Set(PRODUTOS.map((p) => p[1]))) {
      const c = await prisma.categoria.upsert({
        where: { estabelecimento_id_nome: { estabelecimento_id: loja.id, nome } },
        create: { estabelecimento_id: loja.id, nome },
        update: {},
      })
      categorias.set(nome, c.id)
    }

    const produtos = new Map<string, { id: string; preco_venda: number }>()
    for (const [i, [nome, categoria, tipo, custo, venda, estoque, minimo]] of PRODUTOS.entries()) {
      const ean_gtin = `78910000${String(i + 1).padStart(5, "0")}`
      let p = await prisma.produto.findUnique({ where: { estabelecimento_id_ean_gtin: { estabelecimento_id: loja.id, ean_gtin } } })
      if (!p) {
        p = await prisma.produto.create({
          data: {
            estabelecimento_id: loja.id,
            nome,
            ean_gtin,
            tipo_medida: tipo,
            preco_custo: custo,
            preco_venda: venda,
            quantidade_atual: estoque,
            quantidade_minima: minimo,
            categorias: { connect: { id: categorias.get(categoria)! } },
          },
        })
        await prisma.movimentacaoEstoque.create({
          data: { estabelecimento_id: loja.id, produto_id: p.id, usuario_id: dono.id, quantidade: estoque, tipo: "ENTRADA", motivo: "REABASTECIMENTO", observacao: "Estoque inicial" },
        })
      }
      produtos.set(nome, { id: p.id, preco_venda: venda })
    }

    const clientes = new Map<string, string>()
    for (const [nome, cpf] of CLIENTES) {
      const c = await prisma.cliente.upsert({
        where: { estabelecimento_id_cpf: { estabelecimento_id: loja.id, cpf } },
        create: { estabelecimento_id: loja.id, nome, cpf },
        update: {},
      })
      clientes.set(nome, c.id)
    }

    const agora = Date.now()
    let turno = await prisma.turnoCaixa.findFirst({ where: { estabelecimento_id: loja.id, status: "ABERTO" } })
    turno ??= await prisma.turnoCaixa.create({
      data: { estabelecimento_id: loja.id, aberto_por_id: gestor.id, valor_abertura: 150, aberto_em: new Date(agora - 6 * HORA) },
    })

    // Vendas só na primeira vez: com vendas, a loja já está em uso e não é mexida.
    if ((await prisma.venda.count({ where: { estabelecimento_id: loja.id } })) === 0) {
      for (const [n, v] of VENDAS.entries()) {
        const quando = new Date(agora - v.horasAtras * HORA)
        const itens = v.itens.map(([nome, quantidade]) => {
          const p = produtos.get(nome)!
          return { produto_id: p.id, quantidade, preco_unitario: p.preco_venda, subtotal: centavos(p.preco_venda * quantidade) }
        })
        const total = centavos(itens.reduce((soma, i) => soma + i.subtotal, 0))
        const pix = v.metodo === "PIX_ABACATEPAY"
        await prisma.$transaction(async (tx) => {
          const venda = await tx.venda.create({
            data: {
              estabelecimento_id: loja.id,
              usuario_id: caixa.id,
              cliente_id: v.cliente ? clientes.get(v.cliente)! : null,
              turno_id: turno.id,
              total_venda: total,
              metodo_pagamento: v.metodo,
              status_pagamento: v.cancelar ? "CANCELADO" : "PAGO",
              taxa_split: pix ? TAXA_PIX : null,
              abacatepay_payment_id: pix ? `seed_pix_${loja.id.slice(0, 8)}_${n}` : null,
              pago_em: quando,
              criada_em: quando,
              cancelada_em: v.cancelar ? new Date(quando.getTime() + 20 * 60 * 1000) : null,
              cancelada_por_id: v.cancelar ? dono.id : null,
              itens: { create: itens },
            },
          })
          for (const i of itens) {
            await tx.produto.update({ where: { id: i.produto_id }, data: { quantidade_atual: { decrement: i.quantidade } } })
            await tx.movimentacaoEstoque.create({
              data: { estabelecimento_id: loja.id, produto_id: i.produto_id, usuario_id: caixa.id, quantidade: i.quantidade, tipo: "SAIDA", motivo: "VENDA", criado_em: quando },
            })
            if (v.cancelar) {
              await tx.produto.update({ where: { id: i.produto_id }, data: { quantidade_atual: { increment: i.quantidade } } })
              await tx.movimentacaoEstoque.create({
                data: { estabelecimento_id: loja.id, produto_id: i.produto_id, usuario_id: dono.id, quantidade: i.quantidade, tipo: "ENTRADA", motivo: "ESTORNO_VENDA", observacao: `Cancelamento da venda ${venda.id.slice(0, 8)}`, criado_em: venda.cancelada_em! },
              })
            }
          }
        })
      }
      console.log(`Vendas de exemplo: ${VENDAS.length} (uma cancelada, uma no Pix).`)
    }

    await prisma.cupom.upsert({
      where: { estabelecimento_id_codigo: { estabelecimento_id: loja.id, codigo: "FID-3Q7K-PUK4" } },
      create: { estabelecimento_id: loja.id, cliente_id: clientes.get("Marina Duarte")!, codigo: "FID-3Q7K-PUK4", valor_desconto: 5 },
      update: {},
    })

    // ── Lojas Premium de teste (cenários 14, 15 e 16) ──────────────────────
    // Recolocadas no estado de partida a cada execução, como o webhook da AbacatePay deixaria.
    const premium = await usuario("premium-teste@exemplo.com", "Dono Premium de Teste", SENHA_PREMIUM)
    for (const c of PREMIUM) {
      const dados = { nome: c.nome, emite_nfce: c.emite_nfce, ...(c.fiscal && FISCAL) }
      const l = await prisma.estabelecimento.upsert({ where: { cnpj: c.cnpj }, create: { cnpj: c.cnpj, ...dados }, update: dados })
      await vincular(premium.id, l.id, "OWNER")
      for (const p of c.produtos ?? []) {
        const fixos = { nome: p.nome, preco_custo: p.custo, preco_venda: p.venda, ncm: p.ncm, cfop: p.cfop, ativo: true, deletado_em: null }
        const existente = await prisma.produto.findUnique({ where: { estabelecimento_id_ean_gtin: { estabelecimento_id: l.id, ean_gtin: p.ean_gtin } } })
        if (existente) {
          await prisma.produto.update({ where: { id: existente.id }, data: fixos })
          continue
        }
        const criado = await prisma.produto.create({ data: { estabelecimento_id: l.id, ean_gtin: p.ean_gtin, quantidade_atual: p.estoque, ...fixos } })
        await prisma.movimentacaoEstoque.create({
          data: { estabelecimento_id: l.id, produto_id: criado.id, usuario_id: premium.id, quantidade: p.estoque, tipo: "ENTRADA", motivo: "REABASTECIMENTO", observacao: "Estoque inicial" },
        })
      }
      const assinatura = {
        status: c.status,
        tipo_plano: "MENSAL" as const,
        trial_expira_em: c.trial_dias === null ? null : new Date(agora + c.trial_dias * DIA),
        periodo_atual_fim: new Date(agora + c.periodo_dias * DIA),
      }
      await prisma.assinatura.upsert({ where: { estabelecimento_id: l.id }, create: { estabelecimento_id: l.id, ...assinatura }, update: assinatura })
    }

    console.log("\nPronto.")
    console.log(`  Dono    apresentacao@exemplo.com / ${SENHA_APRESENTACAO}`)
    console.log(`  Gestor  gestor-apresentacao@exemplo.com / ${SENHA_APRESENTACAO}`)
    console.log(`  Caixa   caixa-apresentacao@exemplo.com / ${SENHA_APRESENTACAO}`)
    console.log(`  Premium premium-teste@exemplo.com / ${SENHA_PREMIUM}  (Trial, Inadimplente e Ativa)`)
    console.log("  Cupom   FID-3Q7K-PUK4 (R$ 5,00, da cliente Marina Duarte)")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((erro) => {
  console.error(erro)
  process.exitCode = 1
})
