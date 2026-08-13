# Fluxo e Estudo Emissão NFCe

## 1. O que é NCM? (O "DNA" do Produto)
A sigla significa Nomenclatura Comum do Mercosul. É um código de 8 dígitos obrigatório para qualquer produto vendido.

* **Para que serve:** Ele diz para o governo exatamente o que você está vendendo. É através dele que o governo sabe se deve cobrar mais imposto (ex: cigarro e bebida alcoólica) ou menos imposto (ex: arroz e feijão).
* **Na prática:** O lojista não precisa inventar esse número. Quando ele compra mercadorias do fornecedor para revender, o NCM já vem escrito na nota fiscal de compra. Ele só precisa copiar esse código de 8 dígitos ao cadastrar o produto no EstoquePay.

## 2. O que é CFOP? (O "GPS" da Operação)
A sigla significa Código Fiscal de Operações e Prestações. É um código de 4 dígitos.

* **Para que serve:** Ele diz para o governo o que está acontecendo com aquele produto (é uma venda? é uma devolução? é uma doação?) e para onde ele está indo (dentro do estado ou fora do estado?).
* **Na prática:** Para o público do EstoquePay (mercearias e docerias locais), 99% das vendas vão usar o mesmo código: 5102 (Venda de mercadoria adquirida de terceiros, vendida dentro do próprio estado). Nós podemos até deixar esse valor pré-preenchido no sistema para facilitar a vida do lojista.

## O Fluxo Completo de uma Venda com NFC-e
Aqui está exatamente o que acontece desde o momento em que o cliente pega uma Coca-Cola até o XML chegar no contador:

1. **A Venda no Balcão:** O caixa bipa o produto no PDV, recebe R$ 5,00 em dinheiro e finaliza a compra.
2. **A Preparação (O nosso Back-end entra em ação):** Em questão de milissegundos, o Fastify junta os dados: "Esta loja (CNPJ X, IE Y) vendeu uma Coca-Cola (NCM 2202.10.00, CFOP 5102) por R$ 5,00 para o CPF Z".
3. **O Disparo Assíncrono:** Para não travar a fila do caixa, o nosso sistema envia esse "pacote" de dados no formato JSON para a nossa API parceira (Focus NFe ou eNotas) em segundo plano.
4. **A Mágica da API:** O Focus NFe pega nosso JSON, usa o Certificado Digital A1 do dono da loja para assinar o documento criptograficamente e bate na porta da SEFAZ (Secretaria da Fazenda do Estado).
5. **A Autorização:** A SEFAZ diz: "Tudo certo, dados válidos". A API parceira gera o PDF (aquele cupom amarelo que a gente recebe no supermercado) e o XML (o arquivo digital oficial).
6. **O Retorno ao EstoquePay:** A API devolve para nós apenas os links. Nós salvamos na nossa tabela de vendas o status como "AUTORIZADA" e os links seguros de download (nfe_url_pdf e nfe_url_xml).
7. **O Fim do Ciclo:** O caixa, se quiser, pode imprimir o PDF ou mostrar o QR Code para o cliente. No final do mês, o dono da loja entra no nosso painel de Configurações, baixa um .zip com todos os links e manda para o contador.

Delegando a parte difícil para a API terceirizada, nós não precisamos calcular a alíquota de impostos nem nos preocupar com a instabilidade dos servidores do governo.
