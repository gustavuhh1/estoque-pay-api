# Status de Implementação vs. Issues do GitHub

> Comparativo entre o que a aplicação faz hoje (branch `development`, a partir da `main`) e o backlog de issues do repositório `gustavuhh1/estoque-pay-api`. Gerado em 2026-09-12, atualizado em 2026-09-19 (módulo Equipe mesclado via PR #72; issues #41/#42 fechadas).

## Como ler este documento

- **Feito**: rota, service e testes existem e cobrem o critério de aceite.
- **Parcial**: existe algo (schema, rota, ou parte da lógica), mas falta um critério de aceite ou o técnico não está 100%.
- **Não iniciado**: nenhum código de módulo — só o `schema.prisma` (quando já modela a tabela).

A base de dados (`prisma/schema.prisma`) já modela **praticamente todas** as entidades do domínio (Estabelecimento, MembroEstabelecimento, Cliente, Cupom, Produto, Categoria, MovimentacaoEstoque, TurnoCaixa, Venda, ItemVenda, Assinatura). Isso significa que o gargalo atual é **camada de aplicação** (service/controller/rotas/regras de negócio), não modelagem.

---

## Fase 01 — Auth, Tenant e Equipe

| Issue | Título | Status GitHub | Status Real | Observação |
| --- | --- | --- | --- | --- |
| #35 | Cadastro e Login (E-mail e Senha) | CLOSED | ✅ Feito | `POST /auth/register`, `POST /auth/login`, erro 409 em e-mail duplicado, testes E2E. |
| #36 | Autenticação SSO (Google) | CLOSED | ✅ Feito | Provider Google configurado em `src/lib/auth.ts` (`socialProviders.google` + plugin `oneTap`), exposto via `/api/auth/*` (handler nativo do better-auth). |
| #37 | Recuperação e Redefinição de Senha | CLOSED | ✅ Feito | `POST /auth/forgot-password` e `POST /auth/reset-password`, e-mail via Brevo. |
| #38 | Gestão de Sessão e Logout | CLOSED | ✅ Feito | Sessão e logout resolvidos pelo handler nativo `/api/auth/*` do better-auth (sign-out, invalidação de cookie); `requireAuth` já rejeita sessão ausente/inválida com 401. |
| #39 | Onboarding e Cargo Automático | CLOSED (PR #69) | ✅ Feito | `POST /estabelecimento` cria a loja e vincula o criador como `OWNER` na mesma `$transaction`. CNPJ validado (dígito verificador) e obrigatório, nome obrigatório, 409 `CNPJ_ALREADY_IN_USE` em duplicidade. |
| #40 | Listagem, Contexto e Dados da Loja | CLOSED (PR #70) | ✅ Feito | `GET /estabelecimento` lista, `PATCH` edita a loja ativa (header `x-estabelecimento-id`), middleware `requireTenant` valida vínculo do usuário à loja. RBAC bloqueando Gestor de editar campos críticos implementado. |
| #41 | Cadastro e Listagem de Funcionários | CLOSED (PR #72) | ✅ Feito | `POST /equipe` vincula direto e sem e-mail (RN01) quando o e-mail já tem conta na plataforma (201). Se não tem, cria um convite pendente (`ConviteFuncionario`) e dispara e-mail via Brevo (202) — o vínculo é criado sozinho quando a pessoa completa o cadastro (e-mail/senha ou Google), via hook `databaseHooks.user.create.after` do better-auth, sem rota nova em `auth`. `GET /equipe` lista membros + convites pendentes. CASHIER bloqueado (`403 ROLE_CANNOT_MANAGE_EQUIPE`); Gestor só atribui o cargo Caixa (`403 ROLE_CANNOT_ASSIGN_ROLE` senão); cadastro duplicado retorna `409 FUNCIONARIO_JA_VINCULADO`. Extensão de escopo combinada com o usuário — issue #41 atualizada. |
| #42 | Edição e Exclusão de Funcionários | CLOSED (PR #72) | ✅ Feito | `PATCH /equipe/:id` edita o cargo; `DELETE /equipe/:id` remove o vínculo. RN02: Gestor recebe `403 ROLE_CANNOT_EDIT_OWNER` ao tentar editar/excluir um Owner. RN03: bloqueia excluir o último Owner da loja (`403 LAST_OWNER_CANNOT_BE_REMOVED`) — estendido também para a edição (rebaixar o último Owner é bloqueado pelo mesmo motivo, decisão documentada na issue). RN06: exclusão revoga as sessões do funcionário (`prisma.session.deleteMany`) — decisão combinada com o usuário: só na exclusão, não na edição de cargo (o `requireTenant` já lê o cargo atualizado a cada request). |

**Nota #41/#42**: exigiu tabela nova `ConviteFuncionario` (migração `20260917000000_add_convite_funcionario`) e um `databaseHooks.user.create.after` em `src/lib/auth.ts`. Mesclado via PR #72 (`feature/equipe-funcionarios` → `development`), issues fechadas automaticamente pelo merge.

---

## Fase 02 — Produtos, Categorias e Auditoria de Estoque

| Issue | Título | Status GitHub | Status Real | Observação |
| --- | --- | --- | --- | --- |
| #43 | Criar Produto e Validação Fiscal (RN09.1) | CLOSED (PR #71) | ✅ Feito | `POST /produto` cria produto na loja ativa. RN09.1 implementada: se `emite_nfce=true` e faltam NCM/CFOP, o produto nasce `ativo=false` automaticamente (nunca bloqueia o cadastro). `ean_gtin` único por loja, 409 `EAN_GTIN_ALREADY_IN_USE` em duplicidade. CASHIER bloqueado (`403 ROLE_CANNOT_MANAGE_PRODUCTS`). |
| #44 | Listar, Editar e Exclusão Permanente de Produto | CLOSED (PR #71) | ✅ Feito | `GET /produto` lista produtos da loja (inclui inativos, exclui deletados). `PATCH /produto/:id` edita e reaplica RN09.1. `DELETE /produto/:id` sempre `204`: hard delete se o produto nunca foi vendido, soft delete (`deletado_em`, libera `ean_gtin`) se já tem venda associada — preserva histórico financeiro sem quebrar a FK `RESTRICT` de `ItemVenda`/`MovimentacaoEstoque`. Produto de outra loja → `404`. |
| #45 | Soft Delete e Trava Fiscal de Reativação (RN09.2) | CLOSED (PR #71) | ✅ Feito | `PATCH /produto/:id/inativar` sempre permitido. `PATCH /produto/:id/reativar` aplica RN09.2: bloqueia com `403 PRODUTO_SEM_CONFORMIDADE_FISCAL` se a loja emite NFC-e e faltam NCM/CFOP. Soft delete descrito acima cobre a parte de preservação de histórico da issue. |
| #46 | CRUD de Categorias e Vínculos N:N | OPEN | ❌ Não iniciado | Schema `Categoria` com N:N implícito para `Produto` já existe. Falta módulo inteiro — próximo candidato natural, reaproveita bastante estrutura do módulo Produto. |
| #47 | Ajuste Manual, Frações e Obrigatoriedade de Motivo | OPEN | ✅ **Feito na branch `feature/estoque-auditoria` (aguardando merge)** | `POST /estoque/movimentacao` com `{ produto_id, tipo, quantidade, motivo, observacao? }`. RN04: quantidade aceita até 3 casas decimais (`multipleOf(0.001)`, batendo com a coluna `Decimal(10,3)`). RN05: o saldo do produto e a linha de auditoria são gravados na **mesma** `$transaction` — nunca um sem o outro. A aritmética roda no banco via `increment`/`decrement` (não em JS), o que evita *lost update* entre duas saídas concorrentes. Saída que deixaria o saldo negativo retorna `409 ESTOQUE_INSUFICIENTE` e reverte tudo. RF14.3: motivo obrigatório, restrito aos 5 manuais (`VENDA`/`ESTORNO_VENDA` ficam reservados ao PDV da Fase 3) e coerente com a direção — `REABASTECIMENTO` só em ENTRADA, `DESCARTE`/`PERDA`/`VENCIMENTO` só em SAIDA, `AJUSTE_MANUAL` em ambas. Produto inativo aceita movimentação (baixa por perda continua necessária); produto de outra loja ou soft-deletado → `404 PRODUTO_NAO_ENCONTRADO`. CASHIER bloqueado (`403 ROLE_CANNOT_MANAGE_ESTOQUE`). |
| #48 | Relatório de Auditoria e Rastreabilidade | OPEN | ✅ **Feito na branch `feature/estoque-auditoria` (aguardando merge)** | `GET /estoque/movimentacoes?produto_id=&page=&limit=` devolve `{ data, total, page, limit }` em ordem cronológica decrescente, com nome do produto e do usuário responsável (RF15.4). **Primeira rota do projeto com querystring** — `limit` default 20 e teto 100. Pegadinha documentada no DTO: parâmetro vazio (`?page=`) é erro de validação, o cliente deve omitir o que não usa. Escopado por loja; CASHIER bloqueado. |
| #49 | Identificação e Listagem de Alertas de Estoque Mínimo | OPEN | ✅ **Feito na branch `feature/estoque-auditoria` (aguardando merge)** | `GET /estoque/alertas` devolve os produtos com `quantidade_atual <= quantidade_minima`, já excluindo inativos e soft-deletados. Usa **field reference** do Prisma (`prisma.produto.fields.quantidade_minima`) pra comparar duas colunas da mesma linha — sem `$queryRaw` e sem filtrar em memória. CASHIER bloqueado. |

**Nota #43/#44/#45**: exigiu campo novo `Produto.deletado_em` (migração `20260913061503_add_produto_soft_delete`). Mesclado na `main` via PR #71 (`feature/produtos-crud-fiscal`), issues fechadas automaticamente pelo merge.

**Nota #47/#48/#49**: não exigiu migração nova — `MovimentacaoEstoque` já existia desde `20260814180326_multi_roles`, só nunca tinha sido escrita por ninguém. Antes desta branch, a quantidade de um produto só mudava por um `PATCH /produto/:id` direto, sem rastro de quem alterou nem por quê; agora existe um caminho auditado. 173/173 testes passando, `tsc --noEmit` limpo, coleção Postman validada via Newman (pasta `Estoque`, 17 requests / 34 assertions). **Atenção ao merge**: esta branch saiu de `development` antes da PR #73 (Categorias) entrar, então os dois PRs tocam os mesmos pontos de `src/routes.ts`, `src/shared/errors/index.ts`, `docs/EstoquePay.postman_collection.json` e deste documento — conflitos pequenos e esperados, a resolver no segundo merge.

---

## Fase 03 — PDV e Pagamentos

| Issue | Título | Status GitHub | Status Real | Observação |
| --- | --- | --- | --- | --- |
| #50 | Busca, Carrinho e Cálculo Automático | OPEN | ❌ Não iniciado | Schema `Venda`/`ItemVenda` prontos. Nenhuma lógica de carrinho/PDV implementada. |
| #51 | Pagamento Manual (Dinheiro e Cartão) | OPEN | ❌ Não iniciado | Depende de #50. Regra de rollback transacional (RNF01) não implementada. |
| #52 | Pix Automático (AbacatePay) e Split | OPEN | ❌ Não iniciado | Nenhuma integração com AbacatePay no código (schema já tem campos `abacatepay_*` e `taxa_split`). |
| #53 | Cancelamento de Venda e Devolução ao Estoque | OPEN | ❌ Não iniciado | Depende de #50/#51 existirem primeiro. |
| #54 | Abertura e Fechamento de Caixa | OPEN | ❌ Não iniciado | Schema `TurnoCaixa` pronto, sem service/rotas. |

---

## Fase 04 — CRM e NFC-e

| Issue | Título | Status GitHub | Status Real | Observação |
| --- | --- | --- | --- | --- |
| #57 | Gestão de Clientes (CRUD Completo) | OPEN | ❌ Não iniciado | Schema `Cliente` pronto (CPF único por loja). Nenhum módulo `crm`. |
| #58 | Histórico de Compras, Inteligência e Fidelidade | OPEN | ❌ Não iniciado | Depende de #57 e de vendas existirem (Fase 03). Schema `Cupom` já pronto. |
| #59 | Pre-check e Ativação do Switch Fiscal (Premium) | OPEN | ❌ Não iniciado | Nenhuma lógica de verificação de plano/certificado/produtos sem NCM-CFOP. |
| #60 | Disparo Assíncrono da NFC-e (Invisível) e CPF Opcional | OPEN | ❌ Não iniciado | Nenhum cliente HTTP para Focus NFe/eNotas configurado. |
| #61 | Webhook de Retorno, Armazenamento e Tolerância a Falhas | OPEN | ❌ Não iniciado | Nenhuma rota de webhook de NFC-e. |

---

## Fase 05 — Assinatura e Meios de Pagamento (SaaS Billing)

> Issues criadas em 2026-09-12 a partir do `docs/Requisitos_e_Regras_de_Negocio_V5_EstoquePay.md` (Fase 5), que não tinha nenhuma issue correspondente até então.

| Issue | Título | Status GitHub | Status Real | Observação |
| --- | --- | --- | --- | --- |
| #64 | Consulta de Planos e Plano Efetivo da Loja (RF01.1, RN00) | OPEN | ⚠️ Parcial | `Assinatura` já existe no schema. Falta a rota de consulta e o helper que deriva o plano (Free/Premium) a partir de `Assinatura.status` — hoje nenhum código lê essa tabela. |
| #65 | Onboarding do Trial Premium com Meio de Pagamento Obrigatório (RF01.2, RN04) | OPEN | ❌ Não iniciado | Nenhuma integração com o AbacatePay para validar/tokenizar meio de pagamento; nenhuma rota de ativação de trial. |
| #66 | Cobrança Recorrente do Plano Premium (RF01.3, RN02, RNF02) | OPEN | ❌ Não iniciado | Nenhuma rotina de cobrança recorrente implementada. |
| #67 | Webhook de Status da Assinatura e Modo Restrito por Inadimplência (RF01.4, RN03) | OPEN | ❌ Não iniciado | Nenhuma rota de webhook de billing; nenhuma lógica de downgrade automático (`emite_nfce = false` em inadimplência). |
| #68 | Limites Operacionais do Plano Free (RN01) | OPEN | ❌ Não iniciado | Depende de #64 (helper de plano efetivo) e dos módulos de produtos/equipe/CRM ainda não implementados (Fases 02 e 01). |

**Bloqueio a observar**: #64 é pré-requisito direto de #68 (e de qualquer regra futura de "Premium vs. Free"). #65–#67 dependem de um client HTTP para o AbacatePay, que hoje só existe para o fluxo de e-mail transacional (Brevo) — não há integração de pagamento no código ainda.

---

## Resumo executivo

- **Concluído**: 11/29 issues fechadas — #35–#38 (módulo `auth`), #39 e #40 (onboarding e listagem/edição de estabelecimento, PRs #69 e #70), #43/#44/#45 (módulo Produtos completo, PR #71), #41/#42 (módulo Equipe/Funcionários completo, PR #72). Todas já mescladas e fechadas.
- **Pronto, pendente de merge**: #46 (Categorias, branch `feature/categorias-crud` / [PR #73](https://github.com/gustavuhh1/estoque-pay-api/pull/73)) e #47/#48/#49 (módulo Estoque: movimentação manual auditada, relatório de auditoria e alertas de estoque mínimo, branch `feature/estoque-auditoria`). As duas branches saíram de `development` em paralelo — a segunda a ser mesclada terá conflitos pequenos em `src/routes.ts`, `src/shared/errors/index.ts` e nos dois docs.
- **Maior lacuna imediata**: com os dois merges acima, a **Fase 02 fecha inteira**. O próximo bloqueio passa a ser a **Fase 03 (PDV, #50–#54)**, que já tem base pronta: o `MovimentacaoEstoque` do módulo Estoque é exatamente onde a venda vai dar baixa (motivos `VENDA`/`ESTORNO_VENDA`, deixados reservados de propósito).
- **Módulos com schema pronto mas zero código de aplicação**: PDV, pagamentos, CRM, NFC-e, assinatura/billing.
- **Integrações externas ainda não iniciadas**: AbacatePay para Pix/split no PDV (#52) e para billing de assinatura (#65–#67), e o emissor de NFC-e (Focus NFe/eNotas, #59–#61). A emissão de NFC-e (Fase 04) também passa a depender da Fase 05: o switch fiscal só pode ligar com plano Premium ativo (`Assinatura.status`), então #59 bloqueia em #64/#65 até existir uma assinatura real para testar contra.
