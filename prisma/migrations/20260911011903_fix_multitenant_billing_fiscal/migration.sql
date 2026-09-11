-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TipoPlano" AS ENUM ('MENSAL', 'ANUAL');

-- DropIndex
DROP INDEX "clientes_cpf_key";

-- AlterTable
ALTER TABLE "categorias" ADD COLUMN     "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "estabelecimentos" ADD COLUMN     "certificado_a1_senha" TEXT,
ADD COLUMN     "emite_nfce" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "itens_venda" ALTER COLUMN "quantidade" SET DATA TYPE DECIMAL(10,3),
ALTER COLUMN "preco_unitario" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "estabelecimento_id" TEXT NOT NULL,
ALTER COLUMN "quantidade" SET DATA TYPE DECIMAL(10,3);

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "preco_custo" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "preco_venda" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "quantidade_atual" SET DATA TYPE DECIMAL(10,3),
ALTER COLUMN "quantidade_minima" SET DATA TYPE DECIMAL(10,3);

-- AlterTable
ALTER TABLE "turnos_caixa" ALTER COLUMN "valor_abertura" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "valor_fechamento" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "abacatepay_payment_id" TEXT,
ADD COLUMN     "atualizada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "cancelada_em" TIMESTAMP(3),
ADD COLUMN     "cancelada_por_id" TEXT,
ADD COLUMN     "nfe_enviada_em" TIMESTAMP(3),
ADD COLUMN     "nfe_erro_mensagem" TEXT,
ADD COLUMN     "nfe_tentativas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pago_em" TIMESTAMP(3),
ADD COLUMN     "taxa_split" DECIMAL(10,2),
ALTER COLUMN "total_venda" SET DATA TYPE DECIMAL(10,2);

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "abacatepay_sub_id" TEXT,
    "abacatepay_customer_id" TEXT,
    "metodo_pagamento_id" TEXT,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'TRIALING',
    "tipo_plano" "TipoPlano" NOT NULL DEFAULT 'MENSAL',
    "trial_expira_em" TIMESTAMP(3),
    "periodo_atual_fim" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_estabelecimento_id_key" ON "assinaturas"("estabelecimento_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_abacatepay_sub_id_key" ON "assinaturas"("abacatepay_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_estabelecimento_id_nome_key" ON "categorias"("estabelecimento_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_estabelecimento_id_cpf_key" ON "clientes"("estabelecimento_id", "cpf");

-- CreateIndex
CREATE INDEX "itens_venda_venda_id_idx" ON "itens_venda"("venda_id");

-- CreateIndex
CREATE INDEX "itens_venda_produto_id_idx" ON "itens_venda"("produto_id");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_estabelecimento_id_criado_em_idx" ON "movimentacoes_estoque"("estabelecimento_id", "criado_em");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_produto_id_idx" ON "movimentacoes_estoque"("produto_id");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_usuario_id_idx" ON "movimentacoes_estoque"("usuario_id");

-- CreateIndex
CREATE INDEX "produtos_estabelecimento_id_ativo_idx" ON "produtos"("estabelecimento_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_estabelecimento_id_ean_gtin_key" ON "produtos"("estabelecimento_id", "ean_gtin");

-- CreateIndex
CREATE INDEX "turnos_caixa_estabelecimento_id_status_idx" ON "turnos_caixa"("estabelecimento_id", "status");

-- CreateIndex
CREATE INDEX "turnos_caixa_usuario_id_idx" ON "turnos_caixa"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_abacatepay_payment_id_key" ON "vendas"("abacatepay_payment_id");

-- CreateIndex
CREATE INDEX "vendas_estabelecimento_id_criada_em_idx" ON "vendas"("estabelecimento_id", "criada_em");

-- CreateIndex
CREATE INDEX "vendas_estabelecimento_id_status_pagamento_idx" ON "vendas"("estabelecimento_id", "status_pagamento");

-- CreateIndex
CREATE INDEX "vendas_cliente_id_idx" ON "vendas"("cliente_id");

-- CreateIndex
CREATE INDEX "vendas_turno_id_idx" ON "vendas"("turno_id");

-- CreateIndex
CREATE INDEX "vendas_usuario_id_idx" ON "vendas"("usuario_id");

-- CreateIndex
CREATE INDEX "vendas_cancelada_por_id_idx" ON "vendas"("cancelada_por_id");

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cancelada_por_id_fkey" FOREIGN KEY ("cancelada_por_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
