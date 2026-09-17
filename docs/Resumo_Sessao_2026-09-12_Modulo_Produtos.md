# Resumo da Sessão — Módulo Produtos (Issues #43, #44, #45)

> Documento de "acorda e lembra": o que foi feito nesta sessão (12→13/09/2026), por quê, e onde a API está agora depois disso. Não é um documento vivo tipo o `Status_Implementacao_vs_Issues.md` — é um snapshot desta sessão específica.

## TL;DR

Implementado do zero o módulo **Produtos** (CRUD completo + regras fiscais), fechando as issues **#43**, **#44** e **#45** da Fase 2. Branch: `feature/produtos-crud-fiscal` (a partir da `development`). **104/104 testes passando**, `tsc --noEmit` limpo. Commits ainda não feitos — combinamos que eu preparo sem me incluir como autor, e você valida antes de subir pro GitHub.

## O que foi implementado

### Issue #43 — Criar Produto (RF01.1) + trava fiscal (RN09.1)

- `POST /produto` — cria produto na loja ativa (header `x-estabelecimento-id`).
- **RN09.1 (Inativação de Segurança)**: se a loja tem NFC-e ligada (`emite_nfce=true`) e o produto é salvo sem NCM ou CFOP, o cadastro **não é bloqueado** — o produto nasce com `ativo=false` automaticamente. Nunca perde dado, só evita venda fora de conformidade.
- Código de barras (`ean_gtin`) único por loja (não na plataforma inteira) — conflito retorna `409 EAN_GTIN_ALREADY_IN_USE`.

### Issue #44 — Listar, Editar e Excluir (RF02.2 / RF03.3 / RF04.4)

- `GET /produto` — lista produtos da loja ativa (inclui inativos, não inclui excluídos).
- `PATCH /produto/:id` — edita dados cadastrais/fiscais. A RN09.1 também é reaplicada aqui: se você remover o NCM/CFOP de um produto com a loja em NFC-e, ele é automaticamente inativado no mesmo save.
- `DELETE /produto/:id` — exclusão, com uma decisão de design importante (ver abaixo).
- Produto de outra loja → `404` (não `403`, pra não revelar que o recurso existe em outro tenant).

### Issue #45 — Inativar/Reativar (RF05.5 / RF06.6) + trava de reativação (RN09.2)

- `PATCH /produto/:id/inativar` — sempre permitido, sem restrição.
- `PATCH /produto/:id/reativar` — **RN09.2 (Trava de Reativação)**: aqui sim é bloqueante. Se a loja tem NFC-e ligada e o produto não tem NCM/CFOP, a reativação é recusada com `403 PRODUTO_SEM_CONFORMIDADE_FISCAL`.
- Diferença-chave entre as duas travas fiscais: **RN09.1** (save normal) nunca bloqueia, só força inativo; **RN09.2** (reativar) bloqueia de verdade — é um ato explícito do usuário, então pode e deve ser recusado.

## Decisão de design que tomamos juntos: Hard Delete x histórico de vendas

Descobri que `ItemVenda` e `MovimentacaoEstoque` têm FK `RESTRICT` pra `Produto` — ou seja, apagar de verdade um produto que já foi vendido quebraria o banco (ou exigiria apagar o histórico financeiro da venda junto, o que não queríamos).

Sua decisão: nunca perder histórico de venda. Implementei um **soft delete invisível**:

- Produto **nunca vendido** → `DELETE` apaga de verdade (produto + seu histórico de movimentação de estoque).
- Produto **já vendido** → `DELETE` marca `deletado_em` e libera o `ean_gtin` (pra poder reusar o código de barras depois). O produto some de toda listagem de gestão como se tivesse sido apagado, mas a venda antiga continua com o item intacto.
- Do lado de fora (API), as duas situações são idênticas: sempre `204 No Content`. Qual caminho foi tomado é invisível pro cliente.

Isso exigiu um campo novo no schema: `Produto.deletado_em DateTime?` (migração `20260913061503_add_produto_soft_delete`, já aplicada no banco local).

## Outras regras de acesso (RBAC)

- **CASHIER é bloqueado em todo o módulo** (criar, listar, editar, excluir, inativar, reativar) — `403 ROLE_CANNOT_MANAGE_PRODUCTS`. Raciocínio: RN04/05 já diz que Caixa tem acesso estrito ao PDV; a busca de produto no PDV (Fase 3, ainda não implementada) vai ser uma rota própria e mais restrita, não esta.
- OWNER, MANAGER e ADMIN têm acesso total e igual — nenhuma issue distinguiu Gestor de Owner pra produtos (diferente do módulo `estabelecimento`, onde Gestor não mexe em CNPJ/Certificado A1).

## Arquivos novos/alterados

```blank
prisma/schema.prisma                                   (+ campo deletado_em em Produto)
prisma/migrations/20260913061503_add_produto_soft_delete/

src/modules/produto/
├── dto/produto.dto.ts
├── repository/IProdutoRepository.ts
├── repository/ProdutoPrismaRepository.ts
├── repository/InMemoryProdutoRepository.ts
├── service/ProdutoService.ts
├── controller/ProdutoController.ts
├── routes.ts
└── tests/
    ├── produto.spec.ts        (19 cenários, nível service)
    └── produto.e2e.spec.ts    (19 cenários, HTTP via app.inject)

src/shared/errors/index.ts       (+ EanGtinAlreadyInUseError)
src/routes.ts                    (registra produtoRoutes em /produto)
vitest.setup.ts                  (limpa produto/venda/itemVenda/movimentacao entre testes)
```

## Detalhe técnico que vale lembrar

O Prisma devolve campos `Decimal` (preço, quantidade) como objetos `Decimal`, não `number` puro. Tentei converter isso dentro do schema Zod de resposta com `.transform()`, mas o serializador do Zod v4 usado pelo Fastify roda em modo "encode" e **rejeita transforms unidirecionais** (`ZodEncodeError`). Isso só apareceu rodando os testes e2e de verdade — os testes de serviço (sem passar pela serialização HTTP) não pegavam. Corrigido convertendo `Decimal → number` explicitamente no Controller (`toProdutoResponse`), antes do `reply.send()`, com o schema de resposta esperando `number` puro. Fica registrado porque é um padrão que vai se repetir em qualquer módulo futuro que tenha campo `Decimal` (vendas, itens de venda, etc.).

## Estado atual da API (visão geral, pós #43/44/45)

- **Auth** (issue anteriores): cadastro/login e-mail+senha, Google SSO, recuperação de senha — via better-auth.
- **Estabelecimento** (#39, #40): criar loja (vira OWNER automaticamente), listar lojas do usuário, ver/editar dados da loja ativa via header `x-estabelecimento-id`, RBAC por cargo em campos críticos.
- **Produto** (#43, #44, #45 — novo): CRUD completo com regras fiscais dinâmicas (RN09/RN09.1/RN09.2) e soft delete invisível pra preservar histórico de venda.
- **Ainda não implementado**: Categorias (RF07-RF11 da Fase 2), PDV/Carrinho, Pagamentos/AbacatePay, NFC-e, CRM, Assinaturas/Billing (Fase 5 — issues já criadas no GitHub, aguardando implementação).

## Verificação rodada

- `npx prisma migrate dev` — migração aplicada.
- `npx tsc --noEmit` — sem erros de tipo.
- `npx vitest run` — **104/104 testes passando** (nenhum teste antigo de auth/estabelecimento quebrou).

## Pendente pra próxima sessão

1. Você validar os commits antes de eu subir pro GitHub (branch `feature/produtos-crud-fiscal` → PR pra `development`).
2. Conferir manualmente o `/apidocs` com o servidor rodando (não cheguei a subir o servidor nesta sessão pra não conflitar com uma instância que você já tinha rodando).
3. Módulo de Categorias (RF07-RF11) é o próximo candidato natural — reaproveita bastante estrutura do módulo Produto (N:N já existe no schema).
