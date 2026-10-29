import { describe, it, expect } from "vitest"
import { NfceSimuladaEmissor, gerarChaveFicticia } from "../emissor/NfceSimuladaEmissor"
import { AVISO_SIMULACAO, type DadosParaNota } from "../espelho"
import { escaparHtml, renderizarEspelhoHtml } from "../render/renderizarEspelhoHtml"

const DADOS: DadosParaNota = {
  venda_id: "00000000-0000-0000-0000-000000000001",
  estabelecimento: { nome: "Mercearia do Zé", cnpj: "11222333000181", ie: "123456789" },
  consumidor: { identificado: false, nome: null, cpf: null },
  itens: [
    { nome: "Queijo Minas", quantidade: 0.5, preco_unitario: 40, total: 20 },
    { nome: "Pão", quantidade: 3, preco_unitario: 1.5, total: 4.5 },
  ],
  subtotal_itens: 24.5,
  desconto: 0,
  total_venda: 24.5,
  taxa_pix: null,
  total_cobrado: 24.5,
  forma_pagamento: "DINHEIRO",
  pago_em: "2026-10-29T15:30:00.000Z",
}

async function emitir(dados: Partial<DadosParaNota> = {}, numero = 7) {
  return new NfceSimuladaEmissor(() => new Date("2026-10-29T15:31:00.000Z")).emitir(
    { ...DADOS, ...dados },
    numero
  )
}

function ocorrencias(texto: string, trecho: string) {
  return texto.split(trecho).length - 1
}

describe("NfceSimuladaEmissor (D3)", () => {
  it("monta o espelho com número, série e a marca de simulação", async () => {
    const espelho = await emitir()

    expect(espelho).toMatchObject({
      simulada: true,
      aviso: AVISO_SIMULACAO,
      numero: 7,
      serie: 1,
      emitida_em: "2026-10-29T15:31:00.000Z",
      venda_id: DADOS.venda_id,
    })
  })

  it("o aviso é exatamente o texto exigido", () => {
    expect(AVISO_SIMULACAO).toBe(
      "DOCUMENTO SEM VALOR FISCAL — SIMULAÇÃO (emissão real fora do escopo do projeto)"
    )
  })

  it("a chave de acesso é FICTÍCIA: tem letras, 44 caracteres e não é uma chave real", async () => {
    const { chave_de_acesso } = await emitir()

    expect(chave_de_acesso).toHaveLength(44)
    expect(chave_de_acesso.startsWith("SIMULADO")).toBe(true)
    // Uma chave real é 44 DÍGITOS. Esta nunca passa por uma.
    expect(/^\d{44}$/.test(chave_de_acesso)).toBe(false)
  })

  it("cada nota tem a sua chave", () => {
    expect(gerarChaveFicticia()).not.toBe(gerarChaveFicticia())
  })

  it("não inventa protocolo de autorização nem QR Code", async () => {
    const espelho = await emitir()

    expect(Object.keys(espelho).join(" ")).not.toMatch(/protocolo|qr/i)
  })
})

describe("renderizarEspelhoHtml — aviso obrigatório (D3)", () => {
  it("o aviso aparece no topo e no rodapé, e a marca d'água está presente", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(ocorrencias(html, AVISO_SIMULACAO)).toBeGreaterThanOrEqual(2)
    expect(html).toContain('class="marca"')
    expect(html).toContain("SIMULAÇÃO")
    // O título da aba também avisa.
    expect(html).toMatch(/<title>[^<]*SEM VALOR FISCAL/)
  })

  it("o aviso vem ANTES do conteúdo da nota", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html.indexOf(AVISO_SIMULACAO)).toBeLessThan(html.indexOf("Mercearia do Zé"))
  })

  it("diz que a chave é fictícia e que não existe na SEFAZ", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html).toContain("FICTÍCIA")
    expect(html).toContain("não existe na SEFAZ")
  })

  it("não carrega nenhum recurso externo nem script", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/(src|href)=["']https?:/i)
  })

  it("é um HTML5 completo e marcado noindex", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain('<meta name="robots" content="noindex">')
  })
})

describe("renderizarEspelhoHtml — conteúdo (D1, RN03 da Fase 4)", () => {
  it("mostra a loja, os itens e o total", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html).toContain("Mercearia do Zé")
    expect(html).toContain("11.222.333/0001-81")
    expect(html).toContain("IE 123456789")
    expect(html).toContain("Queijo Minas")
    expect(html).toContain("Pão")
    expect(html).toMatch(/TOTAL PAGO[\s\S]*24,50/)
    expect(html).toContain("nº 7")
  })

  it("sem cliente: Consumidor Não Identificado", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html).toContain("Consumidor Não Identificado")
  })

  it("com cliente: nome e CPF formatado", async () => {
    const html = renderizarEspelhoHtml(
      await emitir({ consumidor: { identificado: true, nome: "Maria Souza", cpf: "52998224725" } })
    )

    expect(html).toContain("Maria Souza")
    expect(html).toContain("CPF 529.982.247-25")
    expect(html).not.toContain("Consumidor Não Identificado")
  })

  it("Pix: discrimina a taxa de R$ 0,80 em linha própria e soma ao total pago", async () => {
    const html = renderizarEspelhoHtml(
      await emitir({ forma_pagamento: "PIX", taxa_pix: 0.8, total_cobrado: 25.3 })
    )

    expect(html).toContain("Taxa de serviço Pix")
    expect(html).toMatch(/Taxa de serviço Pix[\s\S]*?0,80/)
    expect(html).toMatch(/TOTAL PAGO[\s\S]*25,30/)
    expect(html).toContain("Pix")
  })

  it("dinheiro e cartão: NÃO têm a linha da taxa", async () => {
    for (const forma of ["DINHEIRO", "DEBITO", "CREDITO"] as const) {
      const html = renderizarEspelhoHtml(await emitir({ forma_pagamento: forma }))

      expect(html).not.toContain("Taxa de serviço Pix")
    }
  })

  it("desconto de cupom ganha linha própria, e só quando existe", async () => {
    const comCupom = renderizarEspelhoHtml(
      await emitir({ desconto: 5, total_venda: 19.5, total_cobrado: 19.5 })
    )
    const semCupom = renderizarEspelhoHtml(await emitir())

    expect(comCupom).toContain("Desconto (cupom)")
    expect(semCupom).not.toContain("Desconto (cupom)")
  })

  it("quantidade fracionada aparece com casas decimais", async () => {
    const html = renderizarEspelhoHtml(await emitir())

    expect(html).toContain("0,5")
  })
})

describe("renderizarEspelhoHtml — segurança", () => {
  it("escapa HTML em nome de produto, de loja e de cliente", async () => {
    const html = renderizarEspelhoHtml(
      await emitir({
        estabelecimento: { nome: "<img src=x onerror=alert(1)>", cnpj: "11222333000181", ie: null },
        itens: [{ nome: "<script>alert('xss')</script>", quantidade: 1, preco_unitario: 1, total: 1 }],
        consumidor: { identificado: true, nome: '"><svg onload=alert(1)>', cpf: null },
      })
    )

    expect(html).not.toContain("<script>alert")
    expect(html).not.toContain("<img src=x")
    expect(html).not.toContain("<svg onload")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escaparHtml cobre os cinco caracteres perigosos", () => {
    expect(escaparHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })
})
