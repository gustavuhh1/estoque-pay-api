-- NFC-e simulada (D3, issue #81). Migração ADITIVA: só acrescenta colunas e um
-- índice, não remove nem altera nada existente.

-- AlterTable
ALTER TABLE "estabelecimentos" ADD COLUMN     "nfce_ultimo_numero" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "nfe_numero" INTEGER,
ADD COLUMN     "nfe_espelho" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "vendas_estabelecimento_id_nfe_numero_key" ON "vendas"("estabelecimento_id", "nfe_numero");
