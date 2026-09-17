-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "deletado_em" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "produtos_estabelecimento_id_deletado_em_idx" ON "produtos"("estabelecimento_id", "deletado_em");
