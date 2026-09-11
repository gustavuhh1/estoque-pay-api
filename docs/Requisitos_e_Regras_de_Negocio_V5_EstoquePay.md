# EstoquePay — Alinhamento de Requisitos (Versão 5)

> Documento consolidado de Requisitos Funcionais, Regras de Negócio e Requisitos Não Funcionais (MVP Completo).

## Sumário

- [Fase 1: Fundação (Autenticação, IAM e Configurações)](#fase-1-fundação-autenticação-iam-e-configurações)
- [Fase 2: Gestão de Estoque](#fase-2-gestão-de-estoque)
- [Fase 3: Core PDV & Pagamentos](#fase-3-core-pdv--pagamentos)
- [Fase 4: CRM e Emissão NFC-e](#fase-4-crm-e-emissão-nfc-e)
- [Fase 5: Assinatura e Meios de Pagamento (SaaS Billing)](#fase-5-assinatura-e-meios-de-pagamento-saas-billing)

---

## Fase 1: Fundação (Autenticação, IAM e Configurações)

### 1. Requisitos Funcionais (RFs) — Módulo: Autenticação & IAM

*O que o sistema deve fazer em relação a acessos e identidades.*

- **RF01.1 - Cadastro e Login (E-mail e Senha):** O sistema deve permitir que novos usuários criem contas nativas e se autentiquem utilizando E-mail e Senha de forma segura.
- **RF01.2 - Autenticação SSO (Google):** O sistema deve permitir o cadastro e login de forma rápida e segura utilizando o Google SSO (Single Sign-On).
- **RF01.3 - Solicitar Recuperação de Senha ("Esqueceu a senha"):** O sistema deve permitir que o usuário solicite a recuperação de acesso, gerando e enviando um token/link seguro para o seu e-mail cadastrado.
- **RF01.4 - Redefinir Senha:** O sistema deve permitir que o usuário cadastre uma nova senha após a validação bem-sucedida do token de recuperação.
- **RF01.5 - Gestão de Sessão:** O sistema deve emitir tokens de autenticação válidos e manter a sessão do usuário ativa nas requisições.
- **RF01.6 - Realizar Logout:** O sistema deve permitir o encerramento da sessão ativa, invalidando imediatamente o token de acesso do usuário.

### 2. Requisitos Funcionais (RFs) — Módulo: Lojas e Multi-Tenant (RBAC por Vínculo)

*O que o sistema deve fazer em relação à gestão de estabelecimentos e permissões dinâmicas.*

- **RF02.1 - Criar Estabelecimento (Onboarding):** O sistema deve permitir que um usuário autenticado crie um novo estabelecimento do zero informando os dados iniciais.
- **RF02.2 - Atribuição de Membro Owner:** Ao criar uma loja, o sistema deve vincular automaticamente o usuário criador àquele estabelecimento com o cargo de "Owner" através da tabela intermediária de membros.
- **RF03.1 - Suporte Multi-Loja (Multi-Tenant N:N):** O sistema deve permitir que um mesmo usuário pertença a múltiplos estabelecimentos simultaneamente, podendo exercer papéis diferentes em cada loja (ex: Owner na Loja A e Caixa na Loja B).
- **RF03.2 - Seleção de Contexto de Loja:** O sistema deve permitir que o usuário selecione qual estabelecimento deseja gerenciar no momento, carregando o dashboard e as permissões correspondentes.
- **RF04.1 - Visualizar e Atualizar Dados da Loja:** O sistema deve exibir e permitir a atualização dos dados cadastrais, comerciais e fiscais da loja ativa (Nome, CNPJ, Inscrição Estadual e Certificado Digital A1).

### 3. Requisitos Funcionais (RFs) — Módulo: Gestão de Funcionários

*O que o sistema deve fazer em relação à equipe e permissões (RBAC).*

- **RF05.1 - Cadastrar Funcionário:** O sistema deve permitir que o Owner ou Gestor adicione um funcionário ao estabelecimento informando nome, e-mail e cargo (Role).
- **RF05.2 - Listar Funcionários:** O sistema deve permitir a visualização em lista de todos os funcionários vinculados à loja ativa e seus respectivos papéis.
- **RF05.3 - Editar Cargo (Role):** O sistema deve permitir alterar o cargo de um funcionário dentro do estabelecimento.
- **RF05.4 - Excluir Funcionário:** O sistema deve permitir remover o vínculo (desvincular) de um funcionário ao estabelecimento.

### 4. Regras de Negócio (RN) e Não Funcionais (RNF) — Fase 1

- **RN01 (Vínculo Silencioso):** O vínculo do funcionário ocorre de forma silenciosa via banco de dados sem envio de e-mails de convite, validando-se pelo login subsequente na plataforma.
- **RN02 (Hierarquia):** Um Gestor não pode excluir, editar ou rebaixar um Owner; apenas o Owner detém privilégios hierárquicos completos.
- **RN03 (Loja Órfã):** É proibido excluir ou rebaixar o último Owner de uma loja, garantindo que o estabelecimento nunca fique sem um dono.
- **RN04/05 (Limites de Roles):** O cargo de "Caixa" possui acesso estrito ao PDV. O "Gestor" possui acesso à operação e equipe, mas é bloqueado em ações críticas (CNPJ, Certificado A1, Plano Premium e exclusão da loja).
- **RN06 (Revogação de Token):** Ao remover um funcionário do estabelecimento, se o mesmo possuir sessão ativa, suas requisições futuras devem ser rejeitadas instantaneamente via middleware.

---

## Fase 2: Gestão de Estoque

### 1. Requisitos Funcionais (RFs) — Módulo: Produtos

- **RF01.1 - Criar Produto:** O sistema deve permitir o cadastro de um novo produto informando campos obrigatórios (nome, preço de custo, preço de venda, tipo de medida, NCM e CFOP).
- **RF02.2 - Listar Produtos:** O sistema deve permitir a listagem de todos os produtos pertencentes ao estabelecimento ativo.
- **RF03.3 - Editar Produto:** O sistema deve permitir a alteração das informações cadastrais, comerciais e fiscais de um produto existente.
- **RF04.4 - Excluir Produto (Hard Delete):** O sistema deve permitir a exclusão permanente de um produto do banco de dados, removendo também seu histórico.
- **RF05.5 - Inativar Produto (Soft Delete):** O sistema deve permitir inativar um produto (`ativo = false`) para que ele pare de aparecer no PDV, mas mantenha seu histórico em vendas passadas.
- **RF06.6 - Reativar Produto:** O sistema deve permitir que um produto inativado volte a ficar ativo para vendas, sujeito às travas de conformidade fiscal.

### 2. Requisitos Funcionais (RFs) — Módulo: Categorias

- **RF07.1 - Criar Categoria:** O sistema deve permitir a criação de novas etiquetas/categorias (ex: "Bebidas", "Frios").
- **RF08.2 - Listar Categorias:** O sistema deve retornar a lista de todas as categorias criadas no estabelecimento.
- **RF09.3 - Editar Categoria:** O sistema deve permitir alterar o nome de uma categoria existente.
- **RF10.4 - Excluir Categoria:** O sistema deve permitir a exclusão de uma categoria sem que isso apague os produtos alocados nela.
- **RF11.5 - Vincular Categoria (N:N):** O sistema deve permitir que um produto seja vinculado a múltiplas categorias simultaneamente.

### 3. Requisitos Funcionais (RFs) — Módulo: Movimentação e Auditoria

- **RF12.1 - Lançar Entrada Manual:** O sistema deve permitir que o usuário adicione quantidade ao estoque de um produto de forma manual.
- **RF13.2 - Lançar Saída Manual:** O sistema deve permitir que o usuário remova quantidade do estoque de um produto de forma manual.
- **RF14.3 - Exigência de Motivo:** O sistema deve exigir a seleção de um motivo obrigatório (ex: Reabastecimento, Descarte, Quebra) em qualquer lançamento manual.
- **RF15.4 - Consultar Auditoria:** O sistema deve exibir um relatório listando todo o histórico de movimentações de um produto, mostrando data, quantidade, motivo e usuário responsável.

### 4. Requisitos Funcionais (RFs) — Módulo: Alertas

- **RF16.1 - Identificar Estoque Mínimo:** O sistema deve identificar automaticamente se a quantidade atual de um produto atingiu ou ficou abaixo da quantidade mínima configurada.
- **RF17.2 - Listagem de Alerta:** O sistema deve fornecer uma consulta específica que retorne apenas os produtos com estoque baixo para alimentar o Dashboard.

### 5. Regras de Negócio (RN) e Não Funcionais (RNF) — Fase 2

- **RN01 - Inativação vs. Exclusão:** Um produto inativo continua no banco com seu histórico, mas fica indisponível para vendas no PDV. A exclusão é permanente.
- **RN02 - Exclusão de Categorias:** A exclusão de uma categoria apenas remove sua etiqueta dos produtos, mantendo os itens intactos.
- **RN04 - Suporte a Frações:** O sistema suporta operações matemáticas com casas decimais (ex: 0.300 kg) para produtos fracionados.
- **RN05 - Rastreabilidade Automática:** Nenhuma alteração de estoque ocorre sem gerar um registro imutável na tabela de auditoria (`MovimentacaoEstoque`).
- **RN09 - Obrigatoriedade Fiscal Dinâmica (Switch NFC-e):** Se a NFC-e estiver desligada, NCM e CFOP são opcionais. Se a emissão de NFC-e estiver ligada na loja, passam a ditar a conformidade do produto.
- **RN09.1 - Inativação de Segurança (Fallback):** Se a NFC-e estiver ligada e o usuário salvar um produto sem NCM ou CFOP, o sistema salva o registro para evitar perda de dados, mas força `ativo = false` automaticamente.
- **RN09.2 - Trava de Reativação:** O sistema bloqueia qualquer tentativa de alterar `ativo = true` se NCM ou CFOP estiverem vazios e a loja estiver com NFC-e ativada.
- **RNF01/02 - Schema & TDD:** Atualização do Prisma para suportar `ativo` e auditoria, com cobertura de testes unitários em Vitest.

---

## Fase 3: Core PDV & Pagamentos

### 1. Requisitos Funcionais (RFs) — Módulo: Gestão do Carrinho & PDV

- **RF01.1 - Buscar Produto:** O sistema deve permitir a busca de produtos no PDV por nome ou código de barras (EAN/GTIN).
- **RF01.2 - Adicionar ao Carrinho:** O sistema deve permitir a adição de itens ao carrinho de compras com suporte a quantidades inteiras e fracionadas.
- **RF01.3 - Cálculo Automático:** O sistema deve calcular automaticamente, em tempo real, o subtotal e o valor total da venda baseando-se nos itens do carrinho.

### 2. Requisitos Funcionais (RFs) — Módulo: Processamento de Pagamentos

- **RF02.1 - Pagar em Dinheiro:** O sistema deve permitir o registro manual de pagamento em dinheiro, calculando o troco automaticamente.
- **RF02.2 - Pagar em Cartão:** O sistema deve permitir o registro manual para vendas pagas via maquininhas de cartão físicas.
- **RF03.1 - Gerar QR Code (Pix):** O sistema deve se comunicar dinamicamente com a API do AbacatePay para gerar o QR Code Pix com o valor da compra.
- **RF03.2 - Confirmação Automática (Webhook):** O sistema deve escutar o webhook do AbacatePay e aprovar a venda de forma automática assim que o pagamento for confirmado.
- **RF04.1 - Acionar Split:** Em vendas via Pix, o sistema deve aplicar o split de pagamento do AbacatePay para reter a taxa fixa de serviço de R$ 0,80 para a plataforma.

### 3. Requisitos Funcionais (RFs) — Módulo: Pós-Venda e Turnos

- **RF05.1 - Cancelar Venda:** O sistema deve permitir o cancelamento de uma venda finalizada, alterando seu status no histórico.
- **RF05.2 - Estorno de Estoque:** Ao confirmar um cancelamento, o sistema deve devolver automaticamente as quantidades dos produtos para o estoque.
- **RF06.1 - Abertura de Caixa (Opcional):** O sistema deve permitir que o gestor ou dono registre a abertura do turno informando o fundo de caixa inicial.
- **RF06.2 - Fechamento de Caixa (Opcional):** O sistema deve permitir o encerramento do turno com a declaração do valor final em gaveta.

### 4. Regras de Negócio (RN) e Não Funcionais (RNF) — Fase 3

- **RN01 - Baixa Postergada:** Produtos no carrinho não deduzem estoque. A baixa ocorre estritamente no momento em que a venda é consolidada e paga.
- **RN02 - Segurança de Cancelamento:** O cancelamento de vendas concluídas é autorizado unicamente a usuários com cargos de Owner ou Gestor (bloqueado para Caixa).
- **RN03 - Auditoria de Devolução:** O cancelamento gera um registro automatizado de entrada na tabela `MovimentacaoEstoque` com o motivo "Estorno/Cancelamento de Venda".
- **RN04 - Segurança de Turno:** Abertura e fechamento de caixa são estritamente restritos aos cargos Owner ou Gestor.
- **RNF01 - Integridade Transacional:** O fechamento da venda e a dedução do estoque ocorrem em transação atômica única no Prisma (`$transaction`). Se houver falha, a venda é desfeita.
- **RNF02 - Segurança de Webhooks:** A rota de webhook do AbacatePay valida assinatura criptográfica para bloquear requisições falsas.

---

## Fase 4: CRM e Emissão NFC-e

### 1. Requisitos Funcionais (RFs) — Módulo: CRM (Gestão de Clientes)

- **RF01.1 - Cadastrar Cliente:** Permitir o cadastro de clientes armazenando CPF, Nome, Telefone, Observação e Data de Nascimento.
- **RF01.2 - Listar Clientes:** Exibir a listagem completa de clientes registrados no estabelecimento.
- **RF01.3 - Visualizar Cliente:** Exibir detalhes e observações de um cliente específico.
- **RF01.4 - Atualizar Cliente:** Permitir a edição dos dados cadastrais do cliente.
- **RF02.1 - Vincular Histórico de Compras:** Indexar automaticamente as compras do PDV ao perfil do cliente.
- **RF02.2 - Inteligência de Dados:** Calcular estatísticas de consumo e produtos favoritos do cliente.
- **RF02.3 - Programa de Fidelidade:** Suportar emissão e resgate de cupons de fidelidade atrelados ao cliente.

### 2. Requisitos Funcionais (RFs) — Módulo: Emissão NFC-e (Fiscal)

- **RF03.1 - Disparar Emissão Assíncrona:** Após pagamento confirmado, se a chave de NFC-e estiver ligada, o sistema compila os dados e envia requisição JSON em background para a API parceira (Focus NFe/eNotas).
- **RF04.1 - Escutar Retorno (Webhook):** Receber a resposta da API terceira assim que a SEFAZ autorizar a nota.
- **RF04.2 - Armazenamento de Links:** Atualizar o status da venda e salvar unicamente as URLs seguras de download de PDF e XML no banco.

### 3. Regras de Negócio (RN) e Não Funcionais (RNF) — Fase 4

- **RN01 - Pre-check de Conformidade:** A emissão da nota só ocorre se a loja possuir o Plano Premium ativo, o Switch de NFC-e ligado e cumprir os requisitos prévios (Certificado A1, CNPJ/IE, sem produtos ativos sem NCM/CFOP).
- **RN02 - Processamento Assíncrono:** A comunicação fiscal ocorre de forma invisível no servidor, sem atrasar a tela do caixa.
- **RN03 - CPF Opcional:** Informar CPF na venda é opcional; se vazio, a nota é emitida como "Consumidor Não Identificado".
- **RN04 - Terceirização Fiscal Absoluta:** É proibido gerar XMLs manualmente ou comunicar-se diretamente com a SEFAZ via SOAP, delegando tudo à API parceira.
- **RNF01 - Tolerância a Falhas:** Se a API terceira estiver fora do ar, o sistema marca o status como ERRO e permite reenvio posterior pelo painel, sem travar o PDV.

---

## Fase 5: Assinatura e Meios de Pagamento (SaaS Billing)

### 1. Requisitos Funcionais (RFs) — Módulo: Assinaturas & Billing

- **RF01.1 - Seleção de Plano:** O sistema deve exibir as opções de assinatura do plano Premium (R$ 30,00 mensais ou R$ 299,90 anuais) na interface de configurações.
- **RF01.2 - Onboarding com Trial (7 Dias):** O sistema deve permitir que novos usuários ativem o período de testes de 7 dias gratuitos do plano Premium, exigindo obrigatoriamente o registro prévio de um meio de pagamento válido (Pix ou Cartão de Crédito) através do AbacatePay.
- **RF01.3 - Cobrança Recorrente:** O sistema deve integrar-se com o AbacatePay para processar automaticamente as cobranças recorrentes das assinaturas utilizando o meio de pagamento tokenizado.
- **RF01.4 - Gestão de Status da Assinatura:** O sistema deve escutar os webhooks do AbacatePay para atualizar em tempo real o status da assinatura do estabelecimento (ativa, em trial, inadimplente ou cancelada).

### 2. Regras de Negócio (RN) — Fase 5

- **RN01 - Limites Estritos do Plano Free:** Lojas no plano Free possuem travas operacionais rígidas: limite máximo de 50 produtos cadastrados ativos, máximo de 3 membros na equipe (contando obrigatoriamente o Owner), CRM restrito exclusivamente aos campos de CPF e Nome, e emissão de NFC-e totalmente desativada.
- **RN02 - Manutenção de Taxa Pix no PDV:** O plano Premium não isenta a loja da taxa fixa de R$ 0,80 por transação Pix realizada no PDV, mantendo o modelo de split padrão.
- **RN03 - Comportamento em Downgrade / Inadimplência (Opção B):** Se a assinatura expirar ou o pagamento falhar, a loja não perde o acesso ao painel, mas entra em modo restrito: a NFC-e é desligada imediatamente, e o sistema bloqueia o cadastro de *novos* produtos ou funcionários caso a contagem atual ultrapasse os limites do plano Free.
- **RN04 - Exigência de Pagamento no Trial:** É proibido ativar os 7 dias gratuitos de teste sem que o AbacatePay confirme o registro de um meio de pagamento válido vinculado ao cliente.

### 3. Requisitos Não Funcionais (RNF) — Fase 5

- **RNF01 - Atualização do Schema (Assinaturas e Membros):** O modelo de dados do Prisma deve conter a tabela `MembrosEstabelecimento` para suportar vínculos multi-loja com papéis independentes, além do controle de assinaturas.
- **RNF02 - Segurança de Dados Sensíveis:** O sistema é estritamente proibido de armazenar dados sensíveis de cartões de crédito localmente, delegando a custódia integralmente ao AbacatePay (conformidade de segurança).
