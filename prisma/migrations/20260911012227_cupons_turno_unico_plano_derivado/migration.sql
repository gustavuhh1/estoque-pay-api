-- AlterTable
ALTER TABLE "estabelecimentos" DROP COLUMN "plano";

-- DropEnum
DROP TYPE "Plano";

-- CreateTable
CREATE TABLE "cupons" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "codigo" TEXT NOT NULL,
    "valor_desconto" DECIMAL(10,2) NOT NULL,
    "expira_em" TIMESTAMP(3),
    "resgatado_em" TIMESTAMP(3),
    "venda_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cupons_venda_id_key" ON "cupons"("venda_id");

-- CreateIndex
CREATE INDEX "cupons_cliente_id_idx" ON "cupons"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "cupons_estabelecimento_id_codigo_key" ON "cupons"("estabelecimento_id", "codigo");

-- AddForeignKey
ALTER TABLE "cupons" ADD CONSTRAINT "cupons_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupons" ADD CONSTRAINT "cupons_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupons" ADD CONSTRAINT "cupons_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índice parcial escrito à mão: o Prisma não expressa "WHERE" em @@unique.
-- Impede dois turnos ABERTO para o mesmo operador na mesma loja (RN04 Fase 3).
-- Um operador pode ter turno aberto em lojas diferentes ao mesmo tempo (RF03.1).
-- ATENÇÃO: `prisma db push` e `migrate dev` não conhecem este índice e vão
-- recriá-lo/derrubá-lo. Se regenerar migrations do zero, reaplique este bloco.
CREATE UNIQUE INDEX "turnos_caixa_um_aberto_por_operador"
  ON "turnos_caixa" ("estabelecimento_id", "usuario_id")
  WHERE "status" = 'ABERTO';
