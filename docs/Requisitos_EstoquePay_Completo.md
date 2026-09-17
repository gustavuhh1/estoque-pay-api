# Documento Consolidado de Requisitos - EstoquePay

Este documento centraliza e enumera de forma contínua todos os Requisitos Funcionais (RF), Regras de Negócio (RN) e Requisitos Não Funcionais (RNF) separados pelas fases do projeto.

---

## Fase 1 - Autenticação e Configurações

### Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF01 - Autenticação e Sessão Mista:** O sistema deve permitir que usuários façam login e criem contas utilizando E-mail e Senha de forma segura, bem como através da integração via SSO (Single Sign-On) com o Google. O sistema deve emitir tokens, manter uma sessão ativa e permitir o encerramento da mesma (logout).
- **RF02 - Onboarding (Criação de Estabelecimento):** O sistema deve permitir que um novo usuário autenticado crie um estabelecimento do zero. O sistema deve automaticamente atribuir o cargo de "Owner" a este usuário criador.
- **RF03 - Listagem e Contexto de Lojas:** O sistema deve listar todos os estabelecimentos aos quais o usuário tem acesso. O sistema deve permitir que o usuário selecione uma loja específica para "entrar" e operar o dashboard.
- **RF04 - Cadastrar Funcionário:** O sistema deve permitir que o Owner ou Gestor adicione um funcionário via nome, e-mail e cargo (Role).
- **RF05 - Listar Funcionários:** O sistema deve permitir a visualização de todos os funcionários atrelados àquela loja.
- **RF06 - Editar Role:** O sistema deve permitir alterar o cargo (Role) de um funcionário existente.
- **RF07 - Excluir Funcionário:** O sistema deve permitir remover o acesso de um funcionário ao estabelecimento.
- **RF08 - Gestão do Estabelecimento:** O sistema deve permitir a visualização e atualização dos dados cadastrais da loja (Nome, CNPJ, Inscrição Estadual e Certificado A1).

### Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam e se protegem._

- **RN01 - Vínculo Silencioso:** O sistema não enviará e-mail de convite. O vínculo de um funcionário à loja ocorre no banco de dados no momento em que o Owner cadastra o e-mail. Quando o funcionário fizer o login SSO, o sistema deve reconhecer o e-mail e liberar o acesso à loja correspondente.
- **RN02 - Hierarquia de Exclusão e Edição:** Um usuário com o cargo "Gestor" pode excluir ou editar caixas e outros gestores, mas **nunca** pode excluir, editar ou rebaixar o cargo de um "Owner".
- **RN03 - Proteção de Loja Órfã:** O sistema deve impedir a exclusão do último usuário "Owner" de um estabelecimento, garantindo que a loja nunca fique sem um dono.
- **RN04 - Limites do Cargo 'Caixa':** O usuário com a role "Caixa" tem permissão estrita ao módulo de PDV. Ele não pode visualizar, listar, cadastrar, editar ou excluir funcionários, nem alterar configurações da loja.
- **RN05 - Limites do Cargo 'Gestor':** O usuário com a role "Gestor" tem acesso à gestão da equipe, mas é bloqueado nas ações críticas da loja: não pode alterar o CNPJ, Certificado Digital A1, gerenciar o plano Premium ou excluir o estabelecimento.
- **RN06 - Revogação Imediata:** Ao excluir um funcionário (RF07), se o mesmo estiver com uma sessão ativa no sistema, seu acesso às rotas daquele estabelecimento deve ser bloqueado imediatamente.

### Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF01 - Frameworks Core:** O back-end será desenvolvido em Node.js utilizando o framework Fastify para alta performance.
- **RNF02 - Persistência de Dados:** O banco de dados será o PostgreSQL, com o mapeamento e migrações geridos pelo Prisma ORM.
- **RNF03 - Autenticação & Sessão:** A emissão e validação de tokens de autenticação será gerenciada nativamente pelo framework `better-auth`.
- **RNF04 - Qualidade (TDD):** Toda regra de negócio (Services) dessa fase deve ser coberta por testes unitários e de integração utilizando o Vitest.

---

## Fase 2 - Gestão de Estoque

### Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF09 - Gestão Completa de Produtos (CRUD):** O sistema deve permitir criar, listar, editar e excluir permanentemente produtos do estabelecimento.
- **RF10 - Ativação/Inativação (Visibilidade):** O sistema deve permitir que o gestor alterne o status do produto entre "Ativo" e "Inativo".
- **RF11 - Gestão Completa de Categorias (CRUD):** O sistema deve permitir criar, listar, editar e excluir categorias, além de permitir vincular múltiplas categorias a um único produto (N:N).
- **RF12 - Lançamento Manual de Movimentação:** O sistema deve permitir a alteração (entrada ou saída) da quantidade em estoque de um produto através de uma interface de lançamento, exigindo a seleção de um motivo (Ex: Reabastecimento, Descarte, Perda, Vencimento).
- **RF13 - Relatório de Auditoria/Movimentação:** O sistema deve listar o histórico detalhado de todas as movimentações de estoque de um produto, indicando o usuário responsável, data, quantidade alterada e o motivo pré-definido.
- **RF14 - Exposição de Alertas de Estoque Mínimo:** O sistema deve identificar e disponibilizar rotas para que o front-end exiba (na aba de Estoque e no Dashboard principal) os produtos cuja quantidade_atual seja igual ou inferior à quantidade_minima configurada.

### Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam._

- **RN07 - Regra de Inativação vs. Exclusão:** Um produto "Inativo" continuará no banco de dados com todo o seu histórico, mas será sinalizado para o front-end (PDV) como indisponível/cinza para vendas. A "Exclusão" de um produto, por outro lado, será permanente e apagará também os registros atrelados (como movimentações).
- **RN08 - Exclusão Desimpedida de Categorias:** O sistema não impedirá a exclusão de uma categoria que possua produtos vinculados. Ao excluir a categoria, o back-end deve apenas remover as "etiquetas" dos produtos, mantendo os produtos intactos no estoque.
- **RN09 - Obrigatoriedade Fiscal (NFC-e):** Todo cadastro ou edição de produto deve exigir o preenchimento dos códigos fiscais obrigatórios: NCM (Nomenclatura Comum do Mercosul) e CFOP (Código Fiscal de Operações e Prestações).
- **RN10 - Suporte a Frações:** O sistema deve permitir operações matemáticas de adição, subtração e definição de estoque utilizando casas decimais (ex: 0.300 kg) para produtos não unitários.
- **RN11 - Rastreabilidade Automática:** Nenhuma alteração na quantidade de estoque do produto pode ser feita sem que um registro imutável seja criado na tabela de auditoria (MovimentacaoEstoque).

### Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF05 - Atualização do Schema:** O modelo de dados do Prisma deverá ser atualizado para contemplar o campo booleano ativo na tabela Produto e a criação da tabela MovimentacaoEstoque.
- **RNF06 - Qualidade (TDD):** Todos os cálculos de entrada/saída de frações, limites e exclusões em cascata deverão possuir cobertura de testes unitários utilizando Vitest.

---

## Fase 3 - PDV & Pagamentos

### Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF15 - Buscar Produto:** O sistema deve permitir a busca de produtos (por nome ou código de barras) no terminal de vendas (PDV).
- **RF16 - Adicionar ao Carrinho:** O sistema deve permitir a adição de produtos ao carrinho, com suporte a quantidades inteiras e fracionadas, calculando automaticamente o subtotal e total da venda.
- **RF17 - Pagamento em Dinheiro:** O sistema deve permitir o registro manual de vendas pagas em dinheiro, calculando automaticamente o troco devido ao cliente.
- **RF18 - Pagamento no Débito:** O sistema deve permitir o registro de vendas pagas via cartão de débito.
- **RF19 - Pagamento no Crédito:** O sistema deve permitir o registro de vendas pagas via cartão de crédito.
- **RF20 - Pagamento Automatizado (Pix):** O sistema deve gerar dinamicamente um QR Code via integração com a API do AbacatePay e escutar o webhook de confirmação para aprovar a venda automaticamente.
- **RF21 - Split de Pagamento:** Em vendas realizadas via Pix, o sistema deve acionar o split no AbacatePay para reter a taxa fixa de serviço (R$ 0,80) para a plataforma EstoquePay.
- **RF22 - Cancelamento e Estorno:** O sistema deve permitir o cancelamento de uma venda já finalizada, alterando seu status e devolvendo as quantidades compradas automaticamente para o estoque.
- **RF23 - Gestão de Turnos (Opcional):** O sistema deve permitir o registro do fundo de caixa inicial (Abertura) e a declaração do valor final (Fechamento) para controle do turno.

### Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam e se protegem._

- **RN12 - Baixa Postergada de Estoque:** A dedução da `quantidade_atual` do produto no estoque só deve ocorrer no momento exato em que a venda for consolidada (pagamento confirmado). Produtos no carrinho não deduzem estoque.
- **RN12.1 - Confirmação Manual de Pagamento:** Para pagamentos em `Dinheiro, Cartão de Crédito e Cartão de Débito`, o status da venda será alterado para **PAGO** unicamente mediante a ação do operador de caixa (Caixa, Gestor ou Owner) no PDV.
- **RN13 - Segurança de Cancelamento:** Apenas usuários autenticados com os cargos de "Owner" ou "Gestor" possuem autorização para cancelar uma venda concluída. Usuários com cargo "Caixa" não podem acessar esta rota.
- **RN14 - Auditoria de Devolução:** Ao cancelar uma venda (RF22), o sistema deve registrar a entrada dos produtos na tabela de `MovimentacaoEstoque` de forma automatizada, utilizando o motivo pré-definido "Estorno/Cancelamento de Venda".
- **RN15 - Segurança de Turno:** A abertura e o fechamento do caixa (RF23) são ações estritamente restritas aos cargos "Owner" e "Gestor".

### Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF07 - Integridade Transacional:** O fechamento da venda e a baixa de estoque devem ser executados em uma única Transação de Banco de Dados (`$transaction` no Prisma). Se a baixa de estoque falhar, a venda não deve ser registrada, garantindo a integridade dos dados.
- **RNF08 - Segurança de Webhooks:** A rota do Fastify que receberá a confirmação de pagamento via Pix do AbacatePay deve validar a assinatura criptográfica do payload para evitar falsas aprovações de vendas injetadas por terceiros.

---

## Fase 4 - CRM e Emissão NFCe

### Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF24 - Gestão de Clientes (CRUD):** O sistema deve permitir o cadastro, listagem, atualização e visualização de clientes, armazenando CPF, Nome, Telefone, Observação e Data de Nascimento.
- **RF25 - Vincular Cliente à Venda:** O sistema deve permitir a vinculação de um cliente previamente cadastrado a uma venda no PDV, possibilitando a emissão de cupons fiscais identificados.
- **RF26 - Histórico e Fidelidade:** O sistema deve realizar a indexação dos clientes às compras realizadas. Com base nisso, o sistema deve fornecer inteligência de dados (como o cálculo de produtos favoritos) e suportar a emissão/resgate de cupons para o programa de fidelidade.
- **RF27 - Preparação Fiscal:** Após a confirmação de um pagamento no PDV, o sistema deve compilar automaticamente os dados da venda, do estabelecimento e do cliente (se houver) no formato exigido pela SEFAZ.
- **RF28 - Disparar Emissão (Integração):** O sistema deve enviar assincronamente (em segundo plano) uma requisição JSON para a API parceira (ex: Focus NFe) com os dados compilados para emissão da NFCe.
- **RF29 - Retorno e Armazenamento Fiscal:** O sistema deve possuir uma rota (webhook) ou rotina para receber o retorno da API terceira, salvando na tabela de vendas apenas o status da emissão e as URLs dos arquivos PDF e XML.

### Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam e se protegem._

- **RN16 - Prorrogação de Cadastro (NFCe):** Para que a emissão de nota fiscal funcione, o sistema exigirá que o estabelecimento tenha cadastrado seu CNPJ, Inscrição Estadual (IE) e feito o upload do Certificado A1. Além disso, os produtos vendidos devem obrigatoriamente possuir NCM e CFOP válidos.
- **RN17 - Processamento Assíncrono:** A comunicação com a API de NFCe não pode travar ou atrasar a tela do caixa. O disparo deve ser assíncrono (emissão "invisível" em segundo plano).
- **RN18 - CPF Opcional:** A vinculação de um cliente (CRM) no momento da venda é opcional. Se não for informado, a NFCe será emitida como "Consumidor Não Identificado".
- **RN19 - Terceirização Fiscal:** O sistema é estritamente proibido de gerar XMLs manualmente ou tentar comunicação direta (mensageria) com a SEFAZ, delegando toda a operação complexa à API parceira.

### Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF09 - Tolerância a Falhas:** Caso a API terceira esteja fora do ar no momento da venda, o sistema deve marcar a `nfe_status` como ERRO e permitir uma retentativa posterior no painel, não impedindo que o caixa continue operando e vendendo normalmente.
