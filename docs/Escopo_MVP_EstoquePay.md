# Documento de Visão e Escopo MVP - EstoquePay

Este documento centraliza a visão arquitetural e de produto para a plataforma EstoquePay, definindo os limites claros (chão e teto) do Produto Mínimo Viável (MVP) para evitar redundâncias e excesso de funcionalidades no início do projeto.

## 1. Visão Geral e Problema
A plataforma visa solucionar a falta de controle integrado entre estoque e pagamentos enfrentada por pequenos e médios empreendedores, como donos de mercearias, bodegas e docerias.

**Objetivo Principal:** Entregar uma aplicação web centralizada com controle de acesso, PDV e gestão de estoque em um único ambiente, facilitando a vida de pequenos e médios comerciantes.

## 2. Público-Alvo (Persona)
* Donos de estabelecimentos comerciais de pequeno e médio porte.
* Gerentes e comerciantes que necessitam de um centralizador de gestão.

## 3. Arquitetura e Stack Tecnológica
* **Arquitetura:** Microsserviços, com separação estrita em dois repositórios distintos (um para o Back-end e outro para o Front-end).
* **Frontend:** Next.js (Repositório exclusivo).
* **Backend:** Fastify (Repositório exclusivo).
* **Banco de Dados:** PostgreSQL.
* **Integrações Iniciais:** AbacatePay (Pix) e API terceira para emissão fiscal (ex: Focus NFe / eNotas).

## 4. Escopo do MVP (O Teto e o Chão)

| Domínio (Módulo) | Escopo Principal (O Chão - MVP) | Limites (O Teto - Fora do MVP) |
| :--- | :--- | :--- |
| **Autenticação (IAM)** | Login e autorização com controle de acesso baseado em Roles (Administrador, Owner, Gestor, Caixa). SSO Login com apenas Google. | Autenticação em 2 Fatores (2FA), SSO com Facebook/Apple. |
| **Estoque** | CRUD de produtos, alertas de quantidade mínima, histórico de movimentação. | Previsão de demanda com IA, integração automatizada com fornecedores. |
| **CRM (Controle de Clientes)** | Cadastro, listagem e atualização de dados (CPF, Nome, Telefone, Observação, Data de Nascimento). Indexação dos clientes às compras realizadas. Uso de inteligência de dados (Cálculo de produtos favoritos) e programa de fidelidade (Cupons). | Campanhas de marketing automatizadas multiplataforma. |
| **PDV** | Iniciar compra, pesquisar produtos, processar carrinho, sumário de compras, cálculo de troco e Abertura/Fechamento de caixa (Opcional, restrito a Owner/Gestor). | Campanhas promocionais automatizadas no caixa. |
| **Pagamentos & Vendas** | Pix 100% integrado via AbacatePay (confirmação automática via webhook); Registro manual para Dinheiro e Cartão; histórico de vendas, split de pagamentos. | Integração automática com adquirentes de cartão (TEF). |
| **Emissão NFCe (Nota Fiscal)** | Serviço dependente do PDV e CRM. Integração via API (Focus NFe/eNotas) para emissão "invisível" em segundo plano. Salva apenas URLs de PDF/XML e Status da nota. | Comunicação direta com a SEFAZ (mensageria), geração manual de XML no nosso back-end. |
| **Configurações** | Dados do estabelecimento (CNPJ, Nome, IE, Certificado A1), gestão da equipe e controle de plano premium.
| **Inteligência Financeira** | Métricas baseadas no `preco_custo`: Dashboard de Lucro Bruto real por venda, trava anti-prejuízo e cálculo do capital imobilizado (Valuation do Estoque). | Emissão de DRE completo, Gestão de Contas a Pagar/Receber e Fluxo de Caixa contábil projetado. |