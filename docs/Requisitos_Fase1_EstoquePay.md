# Documento de Requisitos - Fase 1 (Autenticação e Configurações)

## 1. Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF01 - Autenticação e Sessão Mista:** O sistema deve permitir que usuários façam login e criem contas utilizando E-mail e Senha de forma segura, bem como através da integração via SSO (Single Sign-On) com o Google. O sistema deve emitir tokens, manter uma sessão ativa e permitir o encerramento da mesma (logout).
- **RF02 - Onboarding (Criação de Estabelecimento):** O sistema deve permitir que um novo usuário autenticado crie um estabelecimento do zero. O sistema deve automaticamente atribuir o cargo de "Owner" a este usuário criador.
- **RF03 - Listagem e Contexto de Lojas:** O sistema deve listar todos os estabelecimentos aos quais o usuário tem acesso. O sistema deve permitir que o usuário selecione uma loja específica para "entrar" e operar o dashboard.
- **RF04.1 - Cadastrar Funcionário:** O sistema deve permitir que o Owner ou Gestor adicione um funcionário via nome, e-mail e cargo (Role).
- **RF04.2 - Listar Funcionários:** O sistema deve permitir a visualização de todos os funcionários atrelados àquela loja.
- **RF04.3 - Editar Role:** O sistema deve permitir alterar o cargo (Role) de um funcionário existente.
- **RF04.4 - Excluir Funcionário:** O sistema deve permitir remover o acesso de um funcionário ao estabelecimento.
- **RF05 - Gestão do Estabelecimento:** O sistema deve permitir a visualização e atualização dos dados cadastrais da loja (Nome, CNPJ, Inscrição Estadual e Certificado A1).

## 2. Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam e se protegem._

- **RN01 - Vínculo Silencioso:** O sistema não enviará e-mail de convite. O vínculo de um funcionário à loja ocorre no banco de dados no momento em que o Owner cadastra o e-mail. Quando o funcionário fizer o login SSO, o sistema deve reconhecer o e-mail e liberar o acesso à loja correspondente.
- **RN02 - Hierarquia de Exclusão e Edição:** Um usuário com o cargo "Gestor" pode excluir ou editar caixas e outros gestores, mas **nunca** pode excluir, editar ou rebaixar o cargo de um "Owner".
- **RN03 - Proteção de Loja Órfã:** O sistema deve impedir a exclusão do último usuário "Owner" de um estabelecimento, garantindo que a loja nunca fique sem um dono.
- **RN04 - Limites do Cargo 'Caixa':** O usuário com a role "Caixa" tem permissão estrita ao módulo de PDV. Ele não pode visualizar, listar, cadastrar, editar ou excluir funcionários, nem alterar configurações da loja.
- **RN05 - Limites do Cargo 'Gestor':** O usuário com a role "Gestor" tem acesso à gestão da equipe, mas é bloqueado nas ações críticas da loja: não pode alterar o CNPJ, Certificado Digital A1, gerenciar o plano Premium ou excluir o estabelecimento.
- **RN06 - Revogação Imediata:** Ao excluir um funcionário (RF04), se o mesmo estiver com uma sessão ativa no sistema, seu acesso às rotas daquele estabelecimento deve ser bloqueado imediatamente.

## 3. Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF01 - Frameworks Core:** O back-end será desenvolvido em Node.js utilizando o framework Fastify para alta performance.
- **RNF02 - Persistência de Dados:** O banco de dados será o PostgreSQL, com o mapeamento e migrações geridos pelo Prisma ORM.
- **RNF03 - Autenticação & Sessão:** A emissão e validação de tokens de autenticação será gerenciada nativamente pelo framework `better-auth`.
- **RNF04 - Qualidade (TDD):** Toda regra de negócio (Services) dessa fase deve ser coberta por testes unitários e de integração utilizando o Vitest.
