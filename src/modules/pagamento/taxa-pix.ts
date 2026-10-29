/**
 * D1 (28/10/2026): a taxa de serviço do Pix é PAGA PELO CONSUMIDOR, somada ao
 * total dos itens — o QR Code sai com `itens + TAXA_PIX_REAIS`. Não se aplica a
 * dinheiro nem a cartão de maquininha, e fica gravada em `Venda.taxa_split`.
 *
 * Não é split da AbacatePay: a documentação pública deles não tem split nem
 * campo para o integrador declarar taxa própria (o `platformFee` da resposta é
 * só a tarifa que eles descontam). O valor entra no pagamento como qualquer
 * outro e cai na conta dona da chave de API.
 */
export const TAXA_PIX_REAIS = 0.8

/** Tempo de vida do QR Code. Pix de balcão: o cliente está na frente do caixa. */
export const PIX_EXPIRA_EM_SEGUNDOS = 600
