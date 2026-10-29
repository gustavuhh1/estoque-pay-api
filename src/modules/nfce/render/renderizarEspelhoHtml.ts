import { AVISO_SIMULACAO, CONSUMIDOR_NAO_IDENTIFICADO, type EspelhoNfce } from "../espelho"

const ROTULO_PAGAMENTO: Record<EspelhoNfce["forma_pagamento"], string> = {
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
  DEBITO: "Cartão de débito",
  CREDITO: "Cartão de crédito",
}

/**
 * Nome de produto, de loja e de cliente são dado de usuário: sem escapar, um
 * produto chamado `<script>` rodaria no navegador de quem abre a nota.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 })

function dataHora(iso: string | null): string {
  if (!iso) return "—"

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso))
}

function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "")

  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : cnpj
}

function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "")

  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf
}

/**
 * HTML imprimível do espelho da NFC-e (D3). Autocontido: nenhum recurso
 * externo, nenhum script. O aviso de simulação aparece NO TOPO, NO RODAPÉ e
 * como marca d'água, para sobreviver a qualquer recorte da impressão.
 */
export function renderizarEspelhoHtml(espelho: EspelhoNfce): string {
  const aviso = escaparHtml(AVISO_SIMULACAO)

  const consumidor = espelho.consumidor.identificado
    ? [
        espelho.consumidor.nome ? escaparHtml(espelho.consumidor.nome) : null,
        espelho.consumidor.cpf ? `CPF ${escaparHtml(formatarCpf(espelho.consumidor.cpf))}` : null,
      ]
        .filter(Boolean)
        .join(" — ")
    : CONSUMIDOR_NAO_IDENTIFICADO

  const linhasItens = espelho.itens
    .map(
      (item) => `
        <tr>
          <td>${escaparHtml(item.nome)}</td>
          <td class="num">${quantidade.format(item.quantidade)}</td>
          <td class="num">${moeda.format(item.preco_unitario)}</td>
          <td class="num">${moeda.format(item.total)}</td>
        </tr>`
    )
    .join("")

  const linhaDesconto =
    espelho.desconto > 0
      ? `<tr><td>Desconto (cupom)</td><td class="num">-${moeda.format(espelho.desconto)}</td></tr>`
      : ""

  // D1: a taxa do Pix é discriminada na nota, em linha própria.
  const linhaTaxa =
    espelho.taxa_pix !== null
      ? `<tr><td>Taxa de serviço Pix</td><td class="num">${moeda.format(espelho.taxa_pix)}</td></tr>`
      : ""

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NFC-e simulada nº ${espelho.numero} — SEM VALOR FISCAL</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Courier New", monospace; font-size: 13px; color: #111; margin: 0; padding: 16px; position: relative; }
  .nota { max-width: 380px; margin: 0 auto; position: relative; }
  .aviso { border: 3px solid #b00020; color: #b00020; background: #fff0f0; font-weight: 700; text-align: center; padding: 8px; text-transform: uppercase; font-size: 12px; letter-spacing: .02em; }
  .marca { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .marca span { transform: rotate(-30deg); font-size: 64px; font-weight: 700; color: rgba(176, 0, 32, .12); white-space: nowrap; }
  .conteudo { position: relative; z-index: 1; }
  h1 { font-size: 15px; text-align: center; margin: 12px 0 2px; }
  .centro { text-align: center; }
  .pequeno { font-size: 11px; color: #444; }
  hr { border: 0; border-top: 1px dashed #666; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #666; }
  td, th { padding: 2px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; padding-left: 6px; }
  .total td { font-weight: 700; font-size: 15px; border-top: 1px solid #111; padding-top: 4px; }
  .chave { word-break: break-all; }
  @media print { body { padding: 0; } .marca span { color: rgba(176, 0, 32, .18); } }
</style>
</head>
<body>
<div class="marca" aria-hidden="true"><span>SIMULAÇÃO</span></div>
<div class="nota">
  <div class="aviso" role="alert">${aviso}</div>
  <div class="conteudo">
    <h1>${escaparHtml(espelho.estabelecimento.nome)}</h1>
    <div class="centro pequeno">
      CNPJ ${escaparHtml(formatarCnpj(espelho.estabelecimento.cnpj))}<br>
      ${espelho.estabelecimento.ie ? `IE ${escaparHtml(espelho.estabelecimento.ie)}` : "IE não informada"}
    </div>
    <hr>
    <div class="centro"><strong>NFC-e SIMULADA nº ${espelho.numero}</strong> — série ${espelho.serie}</div>
    <div class="centro pequeno">Emitida em ${dataHora(espelho.emitida_em)}</div>
    <hr>
    <table>
      <thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
      <tbody>${linhasItens}
      </tbody>
    </table>
    <hr>
    <table>
      <tr><td>Subtotal dos itens</td><td class="num">${moeda.format(espelho.subtotal_itens)}</td></tr>
      ${linhaDesconto}
      ${linhaTaxa}
      <tr class="total"><td>TOTAL PAGO</td><td class="num">${moeda.format(espelho.total_cobrado)}</td></tr>
    </table>
    <hr>
    <div>Forma de pagamento: ${ROTULO_PAGAMENTO[espelho.forma_pagamento]}</div>
    <div class="pequeno">Pago em ${dataHora(espelho.pago_em)}</div>
    <hr>
    <div><strong>Consumidor:</strong> ${consumidor}</div>
    <hr>
    <div class="pequeno">Chave de acesso <strong>FICTÍCIA</strong> (simulação):</div>
    <div class="chave pequeno">${escaparHtml(espelho.chave_de_acesso)}</div>
    <div class="pequeno">Sem protocolo de autorização e sem QR Code: este documento não existe na SEFAZ e não pode ser consultado nela.</div>
    <hr>
    <div class="aviso" role="alert">${aviso}</div>
  </div>
</div>
</body>
</html>
`
}
