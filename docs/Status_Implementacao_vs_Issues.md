# Status de Implementação vs. Issues do GitHub

> Comparativo entre o que a aplicação faz hoje (branch `feature/produtos-crud-fiscal`) e o backlog de issues do repositório `gustavuhh1/estoque-pay-api`. Gerado em 2026-09-12, atualizado em 2026-09-14 (módulo Produtos).

## Como ler este documento

- **Feito**: rota, service e testes existem e cobrem o critério de aceite.
- **Parcial**: existe algo (schema, rota, ou parte da lógica), mas falta um critério de aceite ou o técnico não está 100%.
- **Não iniciado**: nenhum código de módulo — só o `schema.prisma` (quando já modela a tabela).

A base de dados (`prisma/schema.prisma`) já modela **praticamente todas** as entidades do domínio (Estabelecimento, MembroEstabelecimento, Cliente, Cupom, Produto, Categoria, MovimentacaoEstoque, TurnoCaixa, Venda, ItemVenda, Assinatura). Isso significa que o gargalo atual é **camada de aplicação** (service/controller/rotas/regras de negócio), não modelagem.

---

## Fase 01 — Auth, Tenant e Equipe

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #35 | Cadastro e Login (E-mail e Senha) | CLOSED | ✅ Feito | `POST /auth/register`, `POST /auth/login`, erro 409 em e-mail duplicado, testes E2E. |
| #36 | Autenticação SSO (Google) | CLOSED | ✅ Feito | Provider Google configurado em `src/lib/auth.ts` (`socialProviders.google` + plugin `oneTap`), exposto via `/api/auth/*` (handler nativo do better-auth). |
| #37 | Recuperação e Redefinição de Senha | CLOSED | ✅ Feito | `POST /auth/forgot-password` e `POST /auth/reset-password`, e-mail via Brevo. |
| #38 | Gestão de Sessão e Logout | CLOSED | ✅ Feito | Sessão e logout resolvidos pelo handler nativo `/api/auth/*` do better-auth (sign-out, invalidação de cookie); `requireAuth` já rejeita sessão ausente/inválida com 401. |
| #39 | Onboarding e Cargo Automático | OPEN (mesclado via PR #69) | ✅ Feito | `POST /estabelecimento` cria a loja e vincula o criador como `OWNER` na mesma `$transaction`. CNPJ validado (dígito verificador) e obrigatório, nome obrigatório, 409 `CNPJ_ALREADY_IN_USE` em duplicidade. |
| #40 | Listagem, Contexto e Dados da Loja | OPEN (mesclado via PR #70) | ✅ Feito | `GET /estabelecimento` lista, `PATCH` edita a loja ativa (header `x-estabelecimento-id`), middleware `requireTenant` valida vínculo do usuário à loja. RBAC bloqueando Gestor de editar campos críticos implementado. |
| #41 | Cadastro e Listagem de Funcionários | OPEN | ❌ Não iniciado | Não existe módulo `equipe`. O schema já suporta (`MembroEstabelecimento.role`), mas falta service/controller/rotas e RBAC (bloqueio de `CASHIER`). |
| #42 | Edição e Exclusão de Funcionários | OPEN | ❌ Não iniciado | Depende do #41. Regras RN02 (Gestor não edita/exclui Owner) e RN03 (não excluir o último Owner) não implementadas. |

**Bloqueio a observar**: #41 e #42 podem reaproveitar o **middleware `requireTenant`** já implementado (via #40) — falta apenas o módulo `equipe` (service/controller/rotas) e a RBAC específica de gestão de funcionários.

---

## Fase 02 — Produtos, Categorias e Auditoria de Estoque

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #43 | Criar Produto e Validação Fiscal (RN09.1) | OPEN | ✅ **Feito nesta branch (aguardando merge)** | `POST /produto` cria produto na loja ativa. RN09.1 implementada: se `emite_nfce=true` e faltam NCM/CFOP, o produto nasce `ativo=false` automaticamente (nunca bloqueia o cadastro). `ean_gtin` único por loja, 409 `EAN_GTIN_ALREADY_IN_USE` em duplicidade. CASHIER bloqueado (`403 ROLE_CANNOT_MANAGE_PRODUCTS`). |
| #44 | Listar, Editar e Exclusão Permanente de Produto | OPEN | ✅ **Feito nesta branch (aguardando merge)** | `GET /produto` lista produtos da loja (inclui inativos, exclui deletados). `PATCH /produto/:id` edita e reaplica RN09.1. `DELETE /produto/:id` sempre `204`: hard delete se o produto nunca foi vendido, soft delete (`deletado_em`, libera `ean_gtin`) se já tem venda associada — preserva histórico financeiro sem quebrar a FK `RESTRICT` de `ItemVenda`/`MovimentacaoEstoque`. Produto de outra loja → `404`. |
| #45 | Soft Delete e Trava Fiscal de Reativação (RN09.2) | OPEN | ✅ **Feito nesta branch (aguardando merge)** | `PATCH /produto/:id/inativar` sempre permitido. `PATCH /produto/:id/reativar` aplica RN09.2: bloqueia com `403 PRODUTO_SEM_CONFORMIDADE_FISCAL` se a loja emite NFC-e e faltam NCM/CFOP. Soft delete descrito acima cobre a parte de preservação de histórico da issue. |
| #46 | CRUD de Categorias e Vínculos N:N | OPEN | ❌ Não iniciado | Schema `Categoria` com N:N implícito para `Produto` já existe. Falta módulo inteiro — próximo candidato natural, reaproveita bastante estrutura do módulo Produto. |
| #47 | Ajuste Manual, Frações e Obrigatoriedade de Motivo | OPEN | ❌ Não iniciado | Schema `MovimentacaoEstoque` pronto (`TipoMovimentacao`, `MotivoMovimentacao`). Falta service transacional de entrada/saída manual. |
| #48 | Relatório de Auditoria e Rastreabilidade | OPEN | ❌ Não iniciado | Depende de #47 gerar os registros primeiro. |
| #49 | Identificação e Listagem de Alertas de Estoque Mínimo | OPEN | ❌ Não iniciado | Query simples (`quantidade_atual <= quantidade_minima`), mas ainda não implementada. |

**Nota #43/#44/#45**: exigiu campo novo `Produto.deletado_em` (migração `20260913061503_add_produto_soft_delete`, já aplicada localmente). 104/104 testes passando, `tsc --noEmit` limpo. Falta: abrir/mesclar o PR (`feature/produtos-crud-fiscal` → `development`) e rodar a migration no ambiente-alvo.

---

## Fase 03 — PDV e Pagamentos

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #50 | Busca, Carrinho e Cálculo Automático | OPEN | ❌ Não iniciado | Schema `Venda`/`ItemVenda` prontos. Nenhuma lógica de carrinho/PDV implementada. |
| #51 | Pagamento Manual (Dinheiro e Cartão) | OPEN | ❌ Não iniciado | Depende de #50. Regra de rollback transacional (RNF01) não implementada. |
| #52 | Pix Automático (AbacatePay) e Split | OPEN | ❌ Não iniciado | Nenhuma integração com AbacatePay no código (schema já tem campos `abacatepay_*` e `taxa_split`). |
| #53 | Cancelamento de Venda e Devolução ao Estoque | OPEN | ❌ Não iniciado | Depende de #50/#51 existirem primeiro. |
| #54 | Abertura e Fechamento de Caixa | OPEN | ❌ Não iniciado | Schema `TurnoCaixa` pronto, sem service/rotas. |

---

## Fase 04 — CRM e NFC-e

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #57 | Gestão de Clientes (CRUD Completo) | OPEN | ❌ Não iniciado | Schema `Cliente` pronto (CPF único por loja). Nenhum módulo `crm`. |
| #58 | Histórico de Compras, Inteligência e Fidelidade | OPEN | ❌ Não iniciado | Depende de #57 e de vendas existirem (Fase 03). Schema `Cupom` já pronto. |
| #59 | Pre-check e Ativação do Switch Fiscal (Premium) | OPEN | ❌ Não iniciado | Nenhuma lógica de verificação de plano/certificado/produtos sem NCM-CFOP. |
| #60 | Disparo Assíncrono da NFC-e (Invisível) e CPF Opcional | OPEN | ❌ Não iniciado | Nenhum cliente HTTP para Focus NFe/eNotas configurado. |
| #61 | Webhook de Retorno, Armazenamento e Tolerância a Falhas | OPEN | ❌ Não iniciado | Nenhuma rota de webhook de NFC-e. |

---

## Fase 05 — Assinatura e Meios de Pagamento (SaaS Billing)

> Issues criadas em 2026-09-12 a partir do `docs/Requisitos_e_Regras_de_Negocio_V5_EstoquePay.md` (Fase 5), que não tinha nenhuma issue correspondente até então.

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #64 | Consulta de Planos e Plano Efetivo da Loja (RF01.1, RN00) | OPEN | ⚠️ Parcial | `Assinatura` já existe no schema. Falta a rota de consulta e o helper que deriva o plano (Free/Premium) a partir de `Assinatura.status` — hoje nenhum código lê essa tabela. |
| #65 | Onboarding do Trial Premium com Meio de Pagamento Obrigatório (RF01.2, RN04) | OPEN | ❌ Não iniciado | Nenhuma integração com o AbacatePay para validar/tokenizar meio de pagamento; nenhuma rota de ativação de trial. |
| #66 | Cobrança Recorrente do Plano Premium (RF01.3, RN02, RNF02) | OPEN | ❌ Não iniciado | Nenhuma rotina de cobrança recorrente implementada. |
| #67 | Webhook de Status da Assinatura e Modo Restrito por Inadimplência (RF01.4, RN03) | OPEN | ❌ Não iniciado | Nenhuma rota de webhook de billing; nenhuma lógica de downgrade automático (`emite_nfce = false` em inadimplência). |
| #68 | Limites Operacionais do Plano Free (RN01) | OPEN | ❌ Não iniciado | Depende de #64 (helper de plano efetivo) e dos módulos de produtos/equipe/CRM ainda não implementados (Fases 02 e 01). |

**Bloqueio a observar**: #64 é pré-requisito direto de #68 (e de qualquer regra futura de "Premium vs. Free"). #65–#67 dependem de um client HTTP para o AbacatePay, que hoje só existe para o fluxo de e-mail transacional (Brevo) — não há integração de pagamento no código ainda.

---

## Resumo executivo

- **Concluído**: 4/29 issues fechadas (#35–#38, módulo `auth`), mais #39 e #40 já mescladas na `main` (PRs #69 e #70) — status GitHub ainda mostra OPEN nessas duas, mas onboarding de estabelecimento, listagem/edição de loja e o middleware multi-tenant (`requireTenant`) já estão em produção.
- **Pronto, pendente de merge**: #43/#44/#45 (módulo Produtos completo: criar com trava fiscal RN09.1, listar/editar/excluir com soft delete invisível, inativar/reativar com trava RN09.2) — implementados nesta branch (`feature/produtos-crud-fiscal`), com 104/104 testes passando e `tsc --noEmit` limpo; falta abrir/mesclar o PR e rodar a migration do Prisma no ambiente-alvo.
- **Maior lacuna imediata**: agora que o middleware multi-tenant + RBAC (`requireTenant`, `MembroEstabelecimento.role`) já existe (via #40) e foi reaproveitado no módulo Produtos, o próximo bloqueio natural é o **módulo de Categorias (#46)** — reaproveita bastante estrutura do módulo Produto (N:N já existe no schema) — seguido de equipe (#41/#42) e auditoria de estoque (#47–#49).
- **Módulos com schema pronto mas zero código de aplicação**: categorias, equipe/funcionários, auditoria de estoque, PDV, pagamentos, CRM, NFC-e, assinatura/billing. Produtos (Fase 02) saiu dessa lista nesta atualização.
- **Integrações externas ainda não iniciadas**: AbacatePay para Pix/split no PDV (#52) e para billing de assinatura (#65–#67), e o emissor de NFC-e (Focus NFe/eNotas, #59–#61). A emissão de NFC-e (Fase 04) também passa a depender da Fase 05: o switch fiscal só pode ligar com plano Premium ativo (`Assinatura.status`), então #59 bloqueia em #64/#65 até existir uma assinatura real para testar contra.
