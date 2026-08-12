# Documento de Requisitos - Fase 3 (PDV & Pagamentos)

## 1. Requisitos Funcionais (RF)
*O que o sistema deve fazer de ponta a ponta.*
* **RF01 - Gestão do Carrinho (PDV):** O sistema deve permitir a busca de produtos (por nome ou código de barras), adição ao carrinho (com suporte a quantidades inteiras e fracionadas), e cálculo automático do subtotal e total da venda.
* **RF02 - Processamento de Pagamento (Dinheiro/Cartão):** O sistema deve permitir o registro manual de vendas, calculando automaticamente o troco devido ao cliente quando o pagamento for em dinheiro.
* **RF03 - Pagamento Automatizado (Pix):** O sistema deve gerar dinamicamente um QR Code via integração com a API do AbacatePay e escutar o webhook de confirmação para aprovar a venda automaticamente.
* **RF04 - Split de Pagamento:** Em vendas realizadas via Pix, o sistema deve acionar o split no AbacatePay para reter a taxa fixa de serviço (R$ 0,80) para a plataforma EstoquePay.
* **RF05 - Cancelamento e Estorno:** O sistema deve permitir o cancelamento de uma venda já finalizada, alterando seu status e devolvendo as quantidades compradas automaticamente para o estoque.
* **RF06 - Gestão de Turnos (Opcional):** O sistema deve permitir o registro do fundo de caixa inicial (Abertura) e a declaração do valor final (Fechamento) para controle do turno.

## 2. Regras de Negócio (RN)
*As restrições e regras que ditam como as funcionalidades operam e se protegem.*
* **RN01 - Baixa Postergada de Estoque:** A dedução da `quantidade_atual` do produto no estoque só deve ocorrer no momento exato em que a venda for consolidada (pagamento confirmado). Produtos no carrinho não deduzem estoque.
* **RN02 - Segurança de Cancelamento:** Apenas usuários autenticados com os cargos de "Owner" ou "Gestor" possuem autorização para cancelar uma venda concluída. Usuários com cargo "Caixa" não podem acessar esta rota.
* **RN03 - Auditoria de Devolução:** Ao cancelar uma venda (RF05), o sistema deve registrar a entrada dos produtos na tabela de `MovimentacaoEstoque` de forma automatizada, utilizando o motivo pré-definido "Estorno/Cancelamento de Venda".
* **RN04 - Segurança de Turno:** A abertura e o fechamento do caixa (RF06) são ações estritamente restritas aos cargos "Owner" e "Gestor".

## 3. Requisitos Não Funcionais (RNF)
*Como o sistema deve se comportar tecnicamente.*
* **RNF01 - Integridade Transacional:** O fechamento da venda e a baixa de estoque devem ser executados em uma única Transação de Banco de Dados (`$transaction` no Prisma). Se a baixa de estoque falhar, a venda não deve ser registrada, garantindo a integridade dos dados.
* **RNF02 - Segurança de Webhooks:** A rota do Fastify que receberá a confirmação de pagamento via Pix do AbacatePay deve validar a assinatura criptográfica do payload para evitar falsas aprovações de vendas injetadas por terceiros.
