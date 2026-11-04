# EstoquePay — Requisitos e Regras de Negócio (V5)

> **Documento único de produto.** Reúne a visão, o escopo do MVP, os Requisitos Funcionais (RF), as Regras de Negócio (RN) e os Requisitos Não Funcionais (RNF). Substitui o `Escopo_MVP_EstoquePay.md`, o `Requisitos_EstoquePay_Completo.md`, o `Fluxo_e_Estudo_Emissao_NFCe.md` (API) e o `ESCOPO-FORA.md` (front), que foram apagados.
>
> Última revisão: 04/11/2026. O que está implementado, issue por issue, fica no `Status_Implementacao_vs_Issues.md`; riscos e dívida técnica conhecidos ficam no `Riscos_e_Pendencias.md`.

## Sumário

- [Visão e escopo](#visão-e-escopo)
- [Decisões de escopo (D1 a D4)](#decisões-de-escopo-d1-a-d4)
- [Fase 1: Fundação (Autenticação, IAM e Configurações)](#fase-1-fundação-autenticação-iam-e-configurações)
- [Fase 2: Gestão de Estoque](#fase-2-gestão-de-estoque)
- [Fase 3: Core PDV & Pagamentos](#fase-3-core-pdv--pagamentos)
- [Fase 4: CRM e NFC-e simulada](#fase-4-crm-e-nfc-e-simulada)
- [Fase 5: Assinatura e Meios de Pagamento (SaaS Billing)](#fase-5-assinatura-e-meios-de-pagamento-saas-billing)
- [Inteligência financeira](#inteligência-financeira)
- [Glossário fiscal (NCM e CFOP)](#glossário-fiscal-ncm-e-cfop)
- [Fora do escopo](#fora-do-escopo)

---

## Visão e escopo

**Problema.** Pequenos e médios comerciantes (mercearias, bodegas, docerias) não têm controle integrado entre estoque e pagamentos.

**Objetivo.** Uma aplicação web única com controle de acesso, PDV, gestão de estoque, clientes e assinatura.

**Público-alvo.** Donos, gerentes e operadores de caixa de estabelecimentos de pequeno e médio porte.

**Arquitetura.** Dois repositórios independentes:

| Peça | Tecnologia | Hospedagem |
| --- | --- | --- |
| Back-end (`estoque-pay-api`) | Node.js, Fastify 5, Prisma 7, Zod 4, better-auth, Vitest | Render (Docker) |
| Banco | PostgreSQL | Neon |
| Front-end (`estoque-pay-front`) | React 19, Vite, TypeScript, Tailwind CSS v4 (padrão shadcn/ui) | Vercel, com proxy de `/api` para a API |
| Integrações | AbacatePay em modo Dev (Pix e assinatura no cartão), Brevo (e-mail) | — |

Detalhes de hospedagem em `Hospedagem_Render_Neon_Vercel.md`.

**Escopo do MVP por módulo**

| Módulo | Dentro do MVP | Fora do MVP |
| --- | --- | --- |
| Autenticação (IAM) | E-mail e senha, login com Google, recuperação de senha, sessão e logout; cargos (Admin, Owner, Gestor, Caixa) por vínculo multi-loja. | 2FA, Magic Links, outros provedores sociais. |
| Estoque | CRUD de produtos e categorias, movimentação manual com motivo, auditoria, alerta de estoque mínimo. | Previsão de demanda, integração com fornecedores. |
| PDV e pagamentos | Busca, carrinho, dinheiro com troco, cartão de maquininha (registro manual), Pix integrado com taxa de R$ 0,80 paga pelo consumidor, cancelamento com estorno, abertura e fechamento de caixa. | TEF (integração automática com adquirentes), PIN de caixa. |
| CRM | Cadastro de clientes, histórico de compras, produtos favoritos, cupons de fidelidade. | Campanhas de marketing automatizadas. |
| NFC-e | **Simulada**: espelho da nota, sem valor fiscal, gerado após a venda paga. | Emissão real (Focus NFe, eNotas, SEFAZ). |
| Configurações | Dados da loja (Nome, CNPJ, IE, Certificado A1), equipe e switch fiscal. | — |
| Assinatura | Premium mensal (R$ 30,00) ou anual (R$ 299,90), só no cartão, trial de 7 dias, cobrança recorrente, webhooks de status, modo restrito. | Múltiplos níveis de plano, cupom na assinatura, boleto, nota fiscal de serviço. |
| Inteligência financeira | Lucro bruto, trava anti-prejuízo e capital imobilizado no painel. | DRE, contas a pagar e receber, fluxo de caixa contábil. |

---

## Decisões de escopo (D1 a D4)

Tomadas em 28/10/2026 e já incorporadas no texto das fases abaixo.

- **D1 — A taxa de R$ 0,80 é paga pelo consumidor, só no Pix.** O total cobrado numa venda Pix é o total dos itens **mais R$ 0,80**. A taxa não existe em dinheiro nem em cartão de maquininha. Ela é gravada na venda (`Venda.taxa_split`) e discriminada na NFC-e simulada. Não há split nem retenção do valor do lojista.
- **D2 — Assinatura Premium só no cartão**, processada pela AbacatePay em modo Dev: R$ 30,00/mês ou R$ 299,90/ano, trial de 7 dias com cartão válido registrado antes da ativação. Pix não é aceito para assinatura.
- **D3 — A NFC-e é simulada.** Não há integração com Focus NFe, eNotas nem SEFAZ. Depois da venda paga, com o switch fiscal ligado, o sistema gera, salva e permite imprimir um espelho da nota, sempre com o aviso **"DOCUMENTO SEM VALOR FISCAL — SIMULAÇÃO (emissão real fora do escopo do projeto)"**.
- **D4 — Fora do escopo:** emissão fiscal real, hardening de produção, 2FA, PIN de caixa, DRE e relatórios contábeis.

---

## Fase 1: Fundação (Autenticação, IAM e Configurações)

### Glossário de cargos (Roles)

O schema (`enum Role`) é a fonte da verdade e usa nomes em inglês. Este documento usa os termos de negócio em português:

| Termo de negócio | Valor no schema |
| --- | --- |
| Administrador (plataforma) | `ADMIN` |
| Owner (dono da loja) | `OWNER` |
| Gestor | `MANAGER` |
| Caixa | `CASHIER` |

O cargo pertence ao **vínculo**, não ao usuário: fica em `MembroEstabelecimento.role`, então a mesma pessoa pode ser `OWNER` numa loja e `CASHIER` em outra.

### 1. RFs — Autenticação & IAM

- **RF01.1 - Cadastro e Login (E-mail e Senha):** criar conta e autenticar com e-mail e senha.
- **RF01.2 - Autenticação SSO (Google):** cadastro e login com Google pelo botão "Continuar com Google" no Login e no Cadastro (better-auth, `POST /api/auth/sign-in/social`). Conta criada pelo Google cai no onboarding; conta existente vai para a seleção de lojas. Configuração das chaves no `.env.example` e em `Hospedagem_Render_Neon_Vercel.md`.
- **RF01.3 - Solicitar Recuperação de Senha:** gerar e enviar por e-mail um link seguro de redefinição.
- **RF01.4 - Redefinir Senha:** cadastrar nova senha após validar o token.
- **RF01.5 - Gestão de Sessão:** emitir e validar a sessão nas requisições.
- **RF01.6 - Logout:** encerrar a sessão e invalidar o acesso imediatamente.

### 2. RFs — Lojas e Multi-Tenant (RBAC por vínculo)

- **RF02.1 - Criar Estabelecimento (Onboarding):** um usuário autenticado cria uma loja informando nome e CNPJ (validado).
- **RF02.2 - Atribuição de Owner:** quem cria a loja vira `OWNER` dela automaticamente.
- **RF03.1 - Multi-Loja (N:N):** um usuário pode pertencer a várias lojas, com cargos diferentes em cada uma.
- **RF03.2 - Seleção de Contexto:** o usuário escolhe a loja ativa; a API recebe o contexto no header `x-estabelecimento-id`.
- **RF04.1 - Dados da Loja:** visualizar e atualizar Nome, CNPJ, Inscrição Estadual e Certificado Digital A1.

### 3. RFs — Gestão de Funcionários

- **RF05.1 - Cadastrar Funcionário:** `OWNER` ou `MANAGER` adiciona funcionário por nome, e-mail e cargo.
- **RF05.2 - Listar Funcionários:** membros da loja ativa e convites pendentes.
- **RF05.3 - Editar Cargo.**
- **RF05.4 - Excluir Funcionário:** remove o vínculo com a loja.

### 4. Regras de Negócio — Fase 1

- **RN01 - Vínculo automático:** se o e-mail já tem conta, o vínculo é criado na hora, sem convite. Se não tem, fica um convite pendente e um e-mail é enviado; o vínculo nasce sozinho quando a pessoa conclui o cadastro.
- **RN02 - Hierarquia:** o Gestor não edita, não exclui nem rebaixa um Owner, e só atribui o cargo Caixa.
- **RN03 - Loja órfã:** é proibido excluir ou rebaixar o último `OWNER` da loja.
- **RN04 - Limites do Caixa:** o `CASHIER` usa o PDV, consulta as próprias vendas e abre e fecha o caixa. Identifica o cliente no balcão, mas não acessa estoque, equipe nem configurações.
- **RN05 - Limites do Gestor:** o `MANAGER` opera a loja e a equipe, mas não altera CNPJ, Certificado A1, plano Premium, switch fiscal nem exclui a loja.
- **RN06 - Revogação imediata:** ao remover um funcionário, as sessões dele são revogadas e as próximas requisições recebem 401.

---

## Fase 2: Gestão de Estoque

### 1. RFs — Produtos

- **RF01.1 - Criar Produto:** campos obrigatórios: nome, preço de custo, preço de venda e tipo de medida. NCM e CFOP são opcionais, e passam a ser **obrigatórios somente quando a emissão de NFC-e está ligada na loja** (RN09).
- **RF02.2 - Listar Produtos** da loja ativa (inclui inativos).
- **RF03.3 - Editar Produto:** dados cadastrais, comerciais e fiscais.
- **RF04.4 - Excluir Produto:** some do cadastro. Produto nunca vendido é apagado de fato; produto já vendido é marcado como excluído (`deletado_em`) para não quebrar o histórico de vendas, e o código de barras é liberado. Para o usuário as duas situações são iguais (`204`).
- **RF05.5 - Inativar Produto:** `ativo = false`; sai do PDV e mantém o cadastro e o histórico.
- **RF06.6 - Reativar Produto:** volta a vender, sujeito à trava fiscal (RN09.2).

### 2. RFs — Categorias

- **RF07.1 - Criar Categoria** (ex.: "Bebidas", "Frios").
- **RF08.2 - Listar Categorias** com os produtos vinculados.
- **RF09.3 - Editar Categoria** (nome).
- **RF10.4 - Excluir Categoria** sem apagar os produtos.
- **RF11.5 - Vínculo N:N:** um produto pode estar em várias categorias.

### 3. RFs — Movimentação e Auditoria

- **RF12.1 - Entrada Manual** de quantidade.
- **RF13.2 - Saída Manual** de quantidade.
- **RF14.3 - Motivo obrigatório** em todo lançamento manual: Reabastecimento (entrada), Descarte, Perda, Vencimento (saída) ou Ajuste Manual (ambos). `VENDA` e `ESTORNO_VENDA` são reservados ao PDV.
- **RF15.4 - Auditoria:** histórico por produto com data, quantidade, motivo e usuário responsável.

### 4. RFs — Alertas

- **RF16.1 - Estoque mínimo:** identificar `quantidade_atual <= quantidade_minima`.
- **RF17.2 - Listagem de alerta:** só os produtos ativos com estoque baixo, para o painel.

### 5. Regras de Negócio — Fase 2

- **RN01 - Inativação vs. exclusão:** inativo continua cadastrado e fora do PDV; excluído some do cadastro (ver RF04.4).
- **RN02 - Exclusão de categoria:** remove só a etiqueta dos produtos.
- **RN04 - Frações:** até 3 casas decimais (ex.: 0,300 kg).
- **RN05 - Rastreabilidade:** nenhuma alteração de saldo acontece sem um registro imutável em `MovimentacaoEstoque`, na mesma transação.
- **RN09 - Obrigatoriedade fiscal condicionada ao switch NFC-e:** com a NFC-e **desligada**, NCM e CFOP são opcionais. Com a NFC-e **ligada** (`Estabelecimento.emite_nfce = true`), todo produto ativo precisa de NCM e CFOP.
  - **RN09.1 - Inativação de segurança:** com a NFC-e ligada, salvar um produto sem NCM ou CFOP não bloqueia o cadastro, mas o produto fica `ativo = false` automaticamente.
  - **RN09.2 - Trava de reativação:** com a NFC-e ligada, reativar produto sem NCM ou CFOP é recusado (`403 PRODUTO_SEM_CONFORMIDADE_FISCAL`).
- **RNF01 - Testes:** regras cobertas por testes unitários e E2E em Vitest.

---

## Fase 3: Core PDV & Pagamentos

### 1. RFs — Carrinho & PDV

- **RF01.1 - Buscar Produto** por nome (parcial) ou código de barras EAN/GTIN (exato). Produto inativo não aparece.
- **RF01.2 - Adicionar ao Carrinho** com quantidades inteiras e fracionadas.
- **RF01.3 - Cálculo automático** de subtotal e total, sempre com o preço lido do banco.
- **RF01.4 - Histórico de vendas:** paginado, com filtros de status e período. Owner e Gestor veem a loja inteira; o Caixa vê só as vendas que ele registrou.

### 2. RFs — Pagamentos

- **RF02.1 - Dinheiro:** registro manual com cálculo do troco.
- **RF02.2 - Cartão (débito ou crédito):** registro manual da venda feita na maquininha.
- **RF03.1 - Pix:** gerar o QR Code pela AbacatePay com o valor cobrado (itens + taxa).
- **RF03.2 - Confirmação automática:** webhook e consulta de status (polling) consolidam a venda quando a AbacatePay confirma o pagamento.
- **RF04.1 - Taxa de R$ 0,80 paga pelo consumidor no Pix (D1):** o consumidor paga `total dos itens − cupom + R$ 0,80`. Não se aplica a dinheiro nem a cartão.
  - **Registro:** `Venda.total_venda` guarda os itens menos o cupom, `Venda.taxa_split` guarda os R$ 0,80 e o QR Code sai com `total_venda + taxa_split`. Relatórios de faturamento, CRM e ticket médio usam `total_venda`, sem a taxa.
  - **Mecanismo:** a AbacatePay não tem split nem campo de taxa do integrador, então a taxa é somada ao valor da cobrança. A regra de negócio vale independente de como o valor é repassado.

### 3. RFs — Pós-venda e Turnos

- **RF05.1 - Cancelar Venda** paga.
- **RF05.2 - Estorno de estoque:** o cancelamento devolve as quantidades ao estoque.
- **RF06.1 - Abrir Caixa:** registrar o fundo de troco inicial. **Qualquer cargo** abre.
- **RF06.2 - Fechar Caixa:** declarar o valor final em gaveta. **Qualquer cargo** fecha.

### 4. Regras de Negócio — Fase 3

- **RN01 - Baixa postergada:** o carrinho não mexe no estoque; a baixa acontece só quando a venda é paga.
- **RN01.1 - Confirmação manual:** dinheiro e cartão viram `PAGO` pela ação do operador no PDV. Pix nunca é confirmado manualmente, só pela AbacatePay.
- **RN02 - Cancelamento restrito:** só `OWNER` e `MANAGER` cancelam venda (`403 ROLE_CANNOT_CANCEL_VENDA` para o Caixa). Autor e data ficam em `Venda.cancelada_por_id` e `Venda.cancelada_em`. Só venda paga pode ser cancelada, e uma vez só.
- **RN03 - Auditoria de devolução:** o cancelamento grava uma ENTRADA com motivo `ESTORNO_VENDA` e mantém a SAÍDA original.
- **RN04 - Turno por loja, aberto por qualquer cargo:** o turno é da loja, não da pessoa. Enquanto houver um turno `ABERTO`, ninguém abre outro (`409 TURNO_JA_ABERTO`). **Owner, Gestor e Caixa abrem e fecham**; quem abriu e quem fechou ficam registrados separadamente (`aberto_por_id`, `fechado_por_id`). Vender exige turno aberto (`409 TURNO_FECHADO`); cancelar não exige. A unicidade é garantida no banco por índice parcial (`WHERE status = 'ABERTO'`).
- **RNF01 - Integridade transacional:** venda, itens, baixa de estoque e auditoria numa única `$transaction`. Se qualquer item falhar, nada é gravado.
- **RNF02 - Segurança do webhook:** o webhook da AbacatePay valida o segredo na query (`?webhookSecret=`) e a assinatura HMAC do corpo; o evento é só gatilho e o status é confirmado consultando a AbacatePay. O processamento é idempotente.

---

## Fase 4: CRM e NFC-e simulada

### 1. RFs — CRM

- **RF01.1 - Cadastrar Cliente:** CPF (validado) e Nome obrigatórios; Telefone, Data de Nascimento e Observação opcionais (Premium). CPF único por loja.
- **RF01.2 - Listar Clientes** com busca por nome ou CPF.
- **RF01.3 - Visualizar Cliente.**
- **RF01.4 - Atualizar Cliente.**
- **RF02.1 - Histórico de compras:** a venda do PDV pode ser vinculada ao cliente.
- **RF02.2 - Inteligência:** total de compras, valor gasto, ticket médio e produtos favoritos (só vendas pagas).
- **RF02.3 - Fidelidade:** cupons nominais ou genéricos da loja, com código único, valor de desconto e validade opcional. O resgate acontece na venda, uma vez só; cancelar a venda devolve o cupom.

### 2. RFs — NFC-e simulada (D3)

- **RF05.1 - Gerar o espelho:** após a venda paga, com o switch fiscal ligado e a loja Premium, o sistema gera e salva uma nota simulada.
- **RF05.2 - Conteúdo:** dados da loja (nome, CNPJ, IE), itens (nome, quantidade, preço unitário, total), desconto de cupom, **linha da taxa de R$ 0,80 quando a venda é Pix**, forma de pagamento, CPF do consumidor ou "Consumidor Não Identificado", data e hora e numeração sequencial por loja.
- **RF05.3 - Consultar e imprimir:** listar as notas da loja, consultar uma nota e abrir a versão imprimível. Owner e Gestor podem reemitir uma nota que falhou.

**Fluxo de uma venda com NFC-e simulada**

1. O caixa finaliza a venda (dinheiro, cartão ou Pix confirmado).
2. Se a loja é Premium e o switch fiscal está ligado, a API monta o espelho com os dados da loja, dos itens e do consumidor.
3. A nota recebe o próximo número da loja e uma chave de acesso fictícia (`SIMULADO` + dígitos), e é salva na própria venda.
4. A tela do PDV mostra a nota com o aviso de simulação, pronta para imprimir.

### 3. Regras de Negócio — Fase 4

- **RN01 - Pre-check do switch fiscal:** ligar a NFC-e exige plano Premium, Certificado A1 com senha, IE preenchida e nenhum produto ativo sem NCM ou CFOP. Desligar é sempre permitido. Só o Owner altera.
- **RN02 - Geração sem travar o caixa:** a nota é gerada fora da transação da venda. Uma falha ao gerá-la **não desfaz a venda**: a venda fica com `nfe_status = ERRO` e pode ser reemitida.
- **RN03 - CPF opcional:** sem cliente, a nota sai como "Consumidor Não Identificado".
- **RN04 - Sem documento fiscal:** o espelho não é XML fiscal, não consulta a SEFAZ e não imita um documento oficial de forma enganosa. Não há protocolo nem QR Code de consulta.
- **RN05 - Aviso obrigatório:** toda saída (resposta da API, tela e impressão) exibe **"DOCUMENTO SEM VALOR FISCAL — SIMULAÇÃO (emissão real fora do escopo do projeto)"**.
- **RN06 - Loja sem NFC-e:** na loja Free ou com o switch desligado, o PDV entrega um comprovante de venda "não fiscal".

---

## Fase 5: Assinatura e Meios de Pagamento (SaaS Billing)

### 1. RFs — Assinaturas & Billing

- **RF01.1 - Planos:** exibir o Premium a R$ 30,00/mês ou R$ 299,90/ano.
- **RF01.2 - Trial de 7 dias com cartão:** ativar o trial exige registrar um **cartão de crédito** válido no checkout da AbacatePay. Pix não é aceito. O cartão é coletado na página da AbacatePay; o backend nunca o recebe.
- **RF01.3 - Cobrança recorrente:** feita pela AbacatePay com o cartão registrado.
- **RF01.4 - Status por webhook:** o status da assinatura (trial, ativa, inadimplente, cancelada) é atualizado pelos webhooks da AbacatePay.
- **RF01.5 - Cancelar assinatura:** o Owner cancela na hora; a loja volta ao Free.

### 2. Regras de Negócio — Fase 5

- **RN00 - Plano derivado:** o plano não é coluna do `Estabelecimento`; ele vem de `Assinatura.status`. É Premium só em `TRIALING` ou `ACTIVE`. Sem assinatura, `PAST_DUE` ou `CANCELED`, valem os limites do Free.
- **RN01 - Limites do Free:** até 50 produtos ativos, até 3 membros na equipe (contando o Owner e os convites pendentes), CRM só com CPF e Nome e NFC-e desligada. Estourar um limite responde `409` (`PLANO_LIMITE_PRODUTOS`, `PLANO_LIMITE_MEMBROS`, `PLANO_RECURSO_PREMIUM`).
- **RN02 - Taxa Pix no Premium:** o Premium não isenta a taxa de R$ 0,80 do Pix, que continua paga pelo consumidor (ver RF04.1 da Fase 3).
- **RN03 - Modo restrito:** se a assinatura vence ou o pagamento falha, a loja mantém o acesso ao painel, a NFC-e é desligada na hora e só os cadastros **novos** acima dos limites do Free são bloqueados.
- **RN04 - Trial exige pagamento confirmado:** a assinatura só é gravada quando a AbacatePay confirma o cartão; abrir o checkout não muda o plano.

### 3. RNF — Fase 5

- **RNF01 - Schema:** `MembroEstabelecimento` para vínculos multi-loja e `Assinatura` para o controle do plano.
- **RNF02 - Dados de cartão:** proibido armazenar dados de cartão; a custódia é toda da AbacatePay.

---

## Inteligência financeira

Baseada no `preco_custo` dos produtos e entregue no painel do front:

- **Lucro bruto** por período (preço de venda − custo dos itens vendidos).
- **Trava anti-prejuízo:** o cadastro do produto avisa e bloqueia preço de venda abaixo do custo.
- **Capital imobilizado:** valor do estoque a preço de custo.

---

## Glossário fiscal (NCM e CFOP)

Só importam quando a loja liga a NFC-e (RN09 da Fase 2).

- **NCM (Nomenclatura Comum do Mercosul):** código de 8 dígitos que diz ao governo **o que** está sendo vendido e define a tributação (ex.: bebida alcoólica paga mais que arroz). O lojista não inventa o número: ele vem na nota fiscal de compra do fornecedor.
- **CFOP (Código Fiscal de Operações e Prestações):** código de 4 dígitos que diz **que operação** é (venda, devolução, doação) e para onde vai (dentro ou fora do estado). Para mercearias e docerias, quase todas as vendas usam **5102** (venda de mercadoria de terceiros dentro do estado).

---

## Fora do escopo

Além do que a tabela de escopo e a D4 listam:

### Emissão real de NFC-e

As issues #60 e #61 da API descreviam a integração com Focus NFe/eNotas e o retorno da SEFAZ. Ficam fora do projeto (D3). A NFC-e simulada usa a interface `INfceEmissor`, então uma emissão real poderia ser plugada no futuro sem mexer no fluxo de venda.
