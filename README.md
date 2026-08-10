# 🎯 Escopo e Funcionalidades (MVP)

## 1. Autenticação & IAM

Controle de acesso baseado em Roles (Administrador, Owner, Gestor, Caixa).

Login SSO exclusivo com Google.

## 2. Gestão de Estoque

CRUD completo de produtos (aceitando unidades inteiras ou fracionadas/peso).

Sistema de Categorização (Muitos-para-Muitos).

Suporte a Código de Barras (EAN/GTIN) para leitores físicos.

Alertas de quantidade mínima e histórico de movimentação.

Registro de obrigatoriedades fiscais (NCM e CFOP).

## 3. CRM (Controle de Clientes)

Cadastro detalhado de clientes (CPF, Nome, Telefone, Observação, Data de Nascimento).

Indexação automática de clientes às compras do PDV.

Inteligência de dados (Cálculo de produtos favoritos).

Programa de fidelidade baseado em Cupons.

## 4. PDV (Ponto de Venda)

Abertura e Fechamento de turno de caixa (Fundo de troco - Restrito a Owner/Gestor).

Processamento de carrinho, cálculo de troco automático e sumário da compra.

## 5. Pagamentos & Vendas

Integração 100% Pix via AbacatePay (Geração de QR Code e confirmação automática via Webhook).

Registro manual de vendas para Cartão (maquininha externa) e Dinheiro.

Histórico completo de vendas e Split de Pagamentos.

## 6. Emissão NFCe (Nota Fiscal)

Emissão "invisível" em segundo plano (Integração com Focus NFe / eNotas).

Armazenamento otimizado (apenas URLs de PDF/XML e Status).

## 7. Configurações da Loja

Gestão de dados da empresa (CNPJ, IE, Certificado A1).

Gestão de equipe e planos de assinatura (Free/Premium).

### 🚦 Como executar o projeto localmente

(Seção a ser preenchida com as instruções de instalação: npm install, docker-compose para banco de dados, scripts de start e dev)

### 🔐 Variáveis de Ambiente (.env)

(Seção a ser preenchida com as chaves necessárias: DATABASE_URL, chaves do AbacatePay, chaves da API de NFCe, etc)
