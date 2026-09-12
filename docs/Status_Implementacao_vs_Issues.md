# Status de Implementação vs. Issues do GitHub

> Comparativo entre o que a aplicação faz hoje (branch `feature/onboarding-cargo-automatico`) e o backlog de issues do repositório `gustavuhh1/estoque-pay-api`. Gerado em 2026-09-12.

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
| **#39** | **Onboarding e Cargo Automático** | **OPEN** | ✅ **Feito nesta branch (aguardando merge)** | `POST /estabelecimento` cria a loja e vincula o criador como `OWNER` na mesma `$transaction`. CNPJ validado (dígito verificador) e obrigatório, nome obrigatório, 409 `CNPJ_ALREADY_IN_USE` em duplicidade. Testes unitários + E2E cobrindo os 3 cenários da issue. **Falta**: rodar a migration do Prisma no ambiente-alvo e abrir o PR/fechar a issue. |
| #40 | Listagem, Contexto e Dados da Loja | OPEN | ❌ Não iniciado | Não existe rota de listagem (`GET /estabelecimento`), nem de atualização (`PATCH`), nem middleware multi-tenant (verificar `estabelecimentoId` no header e o vínculo do usuário). RBAC de "Gestor bloqueado de editar dados críticos" também não existe. |
| #41 | Cadastro e Listagem de Funcionários | OPEN | ❌ Não iniciado | Não existe módulo `equipe`. O schema já suporta (`MembroEstabelecimento.role`), mas falta service/controller/rotas e RBAC (bloqueio de `CASHIER`). |
| #42 | Edição e Exclusão de Funcionários | OPEN | ❌ Não iniciado | Depende do #41. Regras RN02 (Gestor não edita/exclui Owner) e RN03 (não excluir o último Owner) não implementadas. |

**Bloqueio a observar**: #40, #41 e #42 dependem de um **guard/middleware multi-tenant** (resolver `estabelecimentoId` + checar `MembroEstabelecimento` + `role`) que ainda não existe — hoje só há `requireAuth` (autenticação), não autorização por loja/cargo.

---

## Fase 02 — Produtos, Categorias e Auditoria de Estoque

| Issue | Título | Status GitHub | Status Real | Observação |
|---|---|---|---|---|
| #43 | Criar Produto e Validação Fiscal (RN09.1) | OPEN | ❌ Não iniciado | Schema `Produto` pronto (inclui `ncm`, `cfop`, `ativo`). Falta toda a camada de aplicação, inclusive a regra de inativação automática quando `emite_nfce = true` e faltam NCM/CFOP. |
| #44 | Listar, Editar e Exclusão Permanente de Produto | OPEN | ❌ Não iniciado | Nenhuma rota de produto existe ainda. |
| #45 | Soft Delete e Trava Fiscal de Reativação (RN09.2) | OPEN | ❌ Não iniciado | Depende de #43/#44. |
| #46 | CRUD de Categorias e Vínculos N:N | OPEN | ❌ Não iniciado | Schema `Categoria` com N:N implícito para `Produto` já existe. Falta módulo inteiro. |
| #47 | Ajuste Manual, Frações e Obrigatoriedade de Motivo | OPEN | ❌ Não iniciado | Schema `MovimentacaoEstoque` pronto (`TipoMovimentacao`, `MotivoMovimentacao`). Falta service transacional de entrada/saída manual. |
| #48 | Relatório de Auditoria e Rastreabilidade | OPEN | ❌ Não iniciado | Depende de #47 gerar os registros primeiro. |
| #49 | Identificação e Listagem de Alertas de Estoque Mínimo | OPEN | ❌ Não iniciado | Query simples (`quantidade_atual <= quantidade_minima`), mas ainda não implementada. |

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

- **Concluído**: 4/29 issues fechadas (#35–#38), todas do módulo `auth`.
- **Pronto, pendente de merge**: #39 (onboarding de estabelecimento) — implementado nesta branch, com testes passando; falta abrir/mesclar o PR e a migration do Prisma.
- **Maior lacuna imediata**: o middleware/guard **multi-tenant + RBAC por role** (`MembroEstabelecimento.role`). Ele é pré-requisito direto de #40, #41, #42 e, na prática, de toda a Fase 02 em diante (produtos, categorias, PDV etc. sempre exigem "loja ativa + cargo mínimo").
- **Módulos com schema pronto mas zero código de aplicação**: produtos, categorias, auditoria de estoque, PDV, pagamentos, CRM, NFC-e, assinatura/billing — ou seja, da Fase 02 à Fase 05 por completo.
- **Integrações externas ainda não iniciadas**: AbacatePay para Pix/split no PDV (#52) e para billing de assinatura (#65–#67), e o emissor de NFC-e (Focus NFe/eNotas, #59–#61). A emissão de NFC-e (Fase 04) também passa a depender da Fase 05: o switch fiscal só pode ligar com plano Premium ativo (`Assinatura.status`), então #59 bloqueia em #64/#65 até existir uma assinatura real para testar contra.
