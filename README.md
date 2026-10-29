# 📦 EstoquePay API

Bem-vindo ao repositório oficial da API do **EstoquePay**!

O **EstoquePay** é uma solução moderna e eficiente para gestão de estoque e ponto de venda (PDV). Este projeto foi idealizado e planejado por um estudante e está sendo desenvolvido com excelência por uma dedicada equipe de estudantes da **Universidade de Fortaleza (UNIFOR)**. Nosso objetivo é entregar um sistema robusto, rápido e escalável para facilitar o dia a dia de pequenos e médios estabelecimentos comerciais.

---

## 🚀 Tecnologias Utilizadas

O back-end foi construído utilizando as ferramentas e padrões mais modernos do ecossistema JavaScript/TypeScript, focando em alta performance e manutenibilidade (Arquitetura Modular / DDD):

- **Node.js** com **TypeScript**
- **Fastify:** Framework web de altíssima performance.
- **PostgreSQL:** Banco de dados relacional robusto.
- **Prisma ORM:** Mapeamento de dados, migrações e tipagem segura.
- **better-auth:** Gerenciamento completo de autenticação e sessões.
- **Zod:** Validação de dados e schemas.
- **Vitest:** Framework de testes unitários super rápido.
- **Docker:** Para containerização do banco de dados local.

---

## ⚙️ Como Iniciar o Projeto Localmente

Siga o passo a passo abaixo para rodar a aplicação na sua máquina.

### Pré-requisitos

- [Node.js](https://nodejs.org/) (versão 20+ recomendada)
- [Docker](https://www.docker.com/) e Docker Compose instalados

### 1. Clonar o repositório e instalar dependências

```bash
git clone https://github.com/sua-organizacao/estoque-pay-api.git
cd estoque-pay-api
npm install
```

### 2. Configurar Variáveis de Ambiente

Copie o modelo e preencha. O `.env` nunca vai para o git:

```bash
cp .env.example .env
```

O [`.env.example`](.env.example) lista e comenta **todas** as variáveis (banco, better-auth, Google, Brevo e AbacatePay). Para rodar só o básico localmente bastam `DATABASE_URL` e `BETTER_AUTH_SECRET`; o resto habilita e-mail, login Google, Pix e assinatura.

Para os testes, copie também [`.env.test.example`](.env.test.example) para `.env.test`. **Atenção:** o `npm test` roda `prisma migrate reset --force` no banco apontado ali, que apaga todos os dados dele. Use sempre o banco descartável `estoque-db-test` (o compose o cria).

### 3. Iniciar o Banco de Dados (Docker)

Utilize o Docker Compose para subir uma instância local do PostgreSQL em segundo plano:

```bash
docker-compose up -d
```

> **Nota:** Certifique-se de que a porta `5432` não esteja sendo usada por outro serviço na sua máquina.

### 4. Rodar as Migrações do Prisma

Com o banco de dados rodando, aplique as migrações para criar as tabelas:

```bash
npx prisma migrate dev
```

### 5. Iniciar o Servidor de Desenvolvimento

Agora basta iniciar a API em modo de desenvolvimento (com hot-reload ativado):

```bash
npm run dev
```

Pronto! A API estará rodando em `http://localhost:3333`.

---

## 🚀 Produção

### Build e execução

`tsx` é **só para desenvolvimento** (`npm run dev`). Em produção roda o JavaScript compilado pelo `tsup`:

```bash
npm run build   # prisma generate + tsc --noEmit + tsup  ->  dist/server.js
npm start       # node dist/server.js
```

### Docker

A imagem (`Dockerfile`, multi-stage, Node 24 alpine) compila com o `tsup`, instala só as dependências de produção e sobe com `docker/entrypoint.sh`, que aplica as migrações e inicia a API. O `docker-compose.yml` sobe **API + PostgreSQL** (volume `pgdata`, healthcheck dos dois e um banco de teste separado, `estoque-db-test`):

```bash
cp .env.example .env     # preencha os segredos
docker compose up -d     # db + api (a API espera o banco ficar saudável)
docker compose --profile tools up studio   # opcional: Prisma Studio em :5555
```

### Migrações em produção

Estratégia: **`prisma migrate deploy`**, executado pelo `entrypoint.sh` a cada start. Aplica só as migrações versionadas pendentes e nunca apaga dados. **Não** use `db push` nem `migrate reset` em produção. Por isso o `prisma` (CLI) fica em `dependencies`: a imagem de runtime só instala as dependências de produção e precisa dele para migrar sem baixar nada na hora do start.

### Healthcheck

`GET /health` é público e faz um `SELECT 1` no banco: `200 { "status": "ok" }` ou `503 { "status": "error" }` (sem detalhes do erro). É o que o `HEALTHCHECK` do Docker usa e o que serve de smoke test depois do deploy.

---

## ⚠️ Hospedagem: front e API em domínios diferentes

Antes de escolher onde hospedar, saiba que servir o front e a API em **domínios diferentes** quebra o login se nada for ajustado. O cookie de sessão do better-auth é `httpOnly` e viaja com `credentials: include`. Os pontos de atenção:

- **Cookie entre sites:** em domínios diferentes o navegador trata o cookie como de terceiros (`SameSite`/`Secure`, e bloqueio de cookies de terceiros em vários navegadores). O mais seguro é o front e a API no **mesmo site** (ex.: `app.exemplo.com` e `api.exemplo.com`) ou o front fazendo **proxy/rewrite** de `/api` para a API.
- **CORS:** hoje a API usa `cors({ origin: true })` **sem `credentials: true`**. Com isso o navegador **não envia nem aceita cookie** numa chamada entre origens. Será preciso restringir a origem ao front e habilitar `credentials`.
- **Origens confiáveis do better-auth:** a configuração de `trustedOrigins` e a URL base do better-auth precisam apontar para os domínios reais (variáveis `BETTER_AUTH_URL`, `BASE_URL` e `APP_URL`). O `src/lib/auth.ts` hoje passa `baseUrl`, mas a opção do better-auth se chama `baseURL`; a URL efetiva vem de `BETTER_AUTH_URL`.
- **Login com Google:** a URL de callback autorizada no console do Google tem de ser a da API hospedada.
- **Webhook da AbacatePay:** precisa de URL pública. É uma só, para Pix e assinatura: `POST {BASE_URL}/pagamento/webhook/abacatepay?webhookSecret=...`.

Esses ajustes dependem do domínio escolhido, então ficam para a etapa de hospedagem.

---

## 🎯 Escopo e Funcionalidades (MVP)

Abaixo estão os principais módulos desenvolvidos nesta versão inicial:

### 1. Autenticação & IAM

- Controle de acesso baseado em Roles (Administrador, Owner, Gestor, Caixa).
- Login SSO exclusivo com Google.

### 2. Gestão de Estoque

- CRUD completo de produtos (aceitando unidades inteiras ou fracionadas/peso).
- Sistema de Categorização (Muitos-para-Muitos).
- Suporte a Código de Barras (EAN/GTIN) para leitores físicos.
- Alertas de quantidade mínima e histórico detalhado de movimentação.
- Registro de obrigatoriedades fiscais (NCM e CFOP).

### 3. CRM (Controle de Clientes)

- Cadastro detalhado de clientes (CPF, Nome, Telefone, Observação, Data de Nascimento).
- Indexação automática de clientes às compras do PDV.
- Inteligência de dados (Cálculo de produtos favoritos).
- Programa de fidelidade baseado em Cupons.

### 4. PDV (Ponto de Venda)

- Abertura e Fechamento de turno de caixa (Fundo de troco - Restrito a Owner/Gestor).
- Processamento de carrinho, cálculo de troco automático e sumário da compra.

### 5. Pagamentos & Vendas

- Integração 100% Pix via AbacatePay (QR Code, confirmação por polling e por webhook, com baixa de estoque idempotente).
- Registro manual de vendas para Cartão (maquininha externa) e Dinheiro.
- Taxa de serviço de R$ 0,80 paga pelo consumidor, **só no Pix**, discriminada na nota.
- Histórico completo de vendas.

### 6. Emissão NFCe (Nota Fiscal)

- **NFC-e simulada:** a emissão fiscal real está fora do escopo. Depois da venda paga, com o Switch Fiscal ligado (Premium), o sistema gera, guarda e permite imprimir um espelho da nota, sempre com o aviso *DOCUMENTO SEM VALOR FISCAL — SIMULAÇÃO*.

### 7. Configurações da Loja

- Gestão de dados da empresa (CNPJ, IE, Certificado A1).
- Gestão de equipe e planos de assinatura: Free (50 produtos ativos, 3 membros, CRM só com CPF e Nome) e Premium (R$ 30,00/mês ou R$ 299,90/ano, só no cartão, trial de 7 dias).

---

_Desenvolvido com dedicação por estudantes da UNIFOR._ 🎓🚀
