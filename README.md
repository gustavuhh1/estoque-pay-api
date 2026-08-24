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

Crie um arquivo `.env` na raiz do projeto (você pode usar o `.env.example` como base, se houver) e preencha as variáveis principais:

```env
PORT=3333
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/estoquepay?schema=public"
# Adicione aqui chaves do AbacatePay, Focus NFe e Google SSO conforme necessário
```

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
- Integração 100% Pix via AbacatePay (Geração de QR Code e confirmação automática via Webhook).
- Registro manual de vendas para Cartão (maquininha externa) e Dinheiro.
- Histórico completo de vendas e Split de Pagamentos.

### 6. Emissão NFCe (Nota Fiscal)
- Emissão "invisível" em segundo plano (Integração com Focus NFe / eNotas).
- Armazenamento otimizado (apenas URLs de PDF/XML e Status).

### 7. Configurações da Loja
- Gestão de dados da empresa (CNPJ, IE, Certificado A1).
- Gestão de equipe e planos de assinatura (Free/Premium).

---
*Desenvolvido com dedicação por estudantes da UNIFOR.* 🎓🚀
