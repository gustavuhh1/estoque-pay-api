-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OWNER', 'MANAGER', 'CASHIER');

-- CreateEnum
CREATE TYPE "TipoMedida" AS ENUM ('UNIDADE', 'FRACIONADO_KG');

-- CreateEnum
CREATE TYPE "StatusTurno" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "MetodoPagamento" AS ENUM ('PIX_ABACATEPAY', 'DINHEIRO', 'DEBITO', 'CREDITO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "NfeStatus" AS ENUM ('PROCESSANDO', 'AUTORIZADA', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "MotivoMovimentacao" AS ENUM ('REABASTECIMENTO', 'VENDA', 'ESTORNO_VENDA', 'DESCARTE', 'PERDA', 'VENCIMENTO', 'AJUSTE_MANUAL');

-- CreateTable
CREATE TABLE "estabelecimentos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "ie" TEXT,
    "certificado_a1" TEXT,
    "plano" "Plano" NOT NULL DEFAULT 'FREE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estabelecimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membros_estabelecimento" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "estabelecimentoId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "adicionado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membros_estabelecimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "telefone" TEXT,
    "data_nascimento" TIMESTAMP(3),
    "observacao" TEXT,
    "pontos_fidelidade" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ean_gtin" TEXT,
    "tipo_medida" "TipoMedida" NOT NULL DEFAULT 'UNIDADE',
    "preco_custo" DECIMAL(65,30) NOT NULL,
    "preco_venda" DECIMAL(65,30) NOT NULL,
    "quantidade_atual" DECIMAL(65,30) NOT NULL,
    "quantidade_minima" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ncm" TEXT,
    "cfop" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_estoque" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "quantidade" DECIMAL(65,30) NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "motivo" "MotivoMovimentacao" NOT NULL,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos_caixa" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "valor_abertura" DECIMAL(65,30) NOT NULL,
    "valor_fechamento" DECIMAL(65,30),
    "status" "StatusTurno" NOT NULL DEFAULT 'ABERTO',
    "aberto_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechado_em" TIMESTAMP(3),

    CONSTRAINT "turnos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "turno_id" TEXT,
    "total_venda" DECIMAL(65,30) NOT NULL,
    "metodo_pagamento" "MetodoPagamento" NOT NULL,
    "status_pagamento" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "nfe_status" "NfeStatus",
    "nfe_url_pdf" TEXT,
    "nfe_url_xml" TEXT,
    "chave_de_acesso" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_venda" (
    "id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(65,30) NOT NULL,
    "preco_unitario" DECIMAL(65,30) NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "itens_venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CategoriaToProduto" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoriaToProduto_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "estabelecimentos_cnpj_key" ON "estabelecimentos"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "membros_estabelecimento_userId_idx" ON "membros_estabelecimento"("userId");

-- CreateIndex
CREATE INDEX "membros_estabelecimento_estabelecimentoId_idx" ON "membros_estabelecimento"("estabelecimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "membros_estabelecimento_userId_estabelecimentoId_key" ON "membros_estabelecimento"("userId", "estabelecimentoId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_cpf_key" ON "clientes"("cpf");

-- CreateIndex
CREATE INDEX "_CategoriaToProduto_B_index" ON "_CategoriaToProduto"("B");

-- AddForeignKey
ALTER TABLE "membros_estabelecimento" ADD CONSTRAINT "membros_estabelecimento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membros_estabelecimento" ADD CONSTRAINT "membros_estabelecimento_estabelecimentoId_fkey" FOREIGN KEY ("estabelecimentoId") REFERENCES "estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos_caixa" ADD CONSTRAINT "turnos_caixa_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos_caixa" ADD CONSTRAINT "turnos_caixa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos_caixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriaToProduto" ADD CONSTRAINT "_CategoriaToProduto_A_fkey" FOREIGN KEY ("A") REFERENCES "categorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriaToProduto" ADD CONSTRAINT "_CategoriaToProduto_B_fkey" FOREIGN KEY ("B") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
