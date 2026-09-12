---
name: Task de Back-end (TDD)
about: Criar uma nova tarefa de desenvolvimento para a API do EstoquePay
title: "[TASK] -"
labels: API
assignees: ''
type: Feature

---

### 📖 User Story
Como **[Ator/Role]**, eu quero **[Ação]** para que **[Benefício]**.

---

### ✅ Critérios de Aceite (Definition of Done - TDD)
*Adicione aqui os cenários que devem ser testados no Vitest antes da rota ser exposta.*

- [ ] Cenário de sucesso: ...
- [ ] Cenário de falha 1 (Ex: Erro de validação Zod/Falta de dados): ...
- [ ] Cenário de falha 2 (Ex: Regra de negócio violada): ...
- [ ] Cobertura de testes unitários escrita e passando limpo (`npm run test`).

---

### 🛠️ Checklist Técnico (Sub-tasks)
*Passo a passo técnico para o desenvolvimento no Fastify + Prisma.*

- [ ] 1. Atualizar o `schema.prisma` (se necessário) e rodar migração.
- [ ] 2. Escrever e rodar os testes falhando (Red) no `prisma-mock.ts`.
- [ ] 3. Implementar a lógica de negócio no `Service`.
- [ ] 4. Fazer os testes passarem (Green) e refatorar.
- [ ] 5. Criar a rota no `Controller` (Fastify) expondo o serviço.

---

### 📎 Contexto Adicional
*Adicione links para o documento de requisitos, dúvidas ou referências a outras tasks.*
- **Fase Relacionada:** [Ex: Fase 1 - Autenticação]
