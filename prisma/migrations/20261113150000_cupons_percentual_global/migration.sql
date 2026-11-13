-- CreateEnum
CREATE TYPE "TipoDescontoCupom" AS ENUM ('VALOR', 'PERCENTUAL');

-- AlterTable
ALTER TABLE "cupons" ADD COLUMN     "desativado_em" TIMESTAMP(3),
ADD COLUMN     "tipo_desconto" "TipoDescontoCupom" NOT NULL DEFAULT 'VALOR';

-- CreateTable
CREATE TABLE "cupom_usos" (
    "id" TEXT NOT NULL,
    "cupom_id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL,
    "usado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cupom_usos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cupom_usos_venda_id_key" ON "cupom_usos"("venda_id");

-- CreateIndex
CREATE INDEX "cupom_usos_cupom_id_usado_em_idx" ON "cupom_usos"("cupom_id", "usado_em");

-- CreateIndex
CREATE UNIQUE INDEX "cupom_usos_cupom_id_cpf_key" ON "cupom_usos"("cupom_id", "cpf");

-- AddForeignKey
ALTER TABLE "cupom_usos" ADD CONSTRAINT "cupom_usos_cupom_id_fkey" FOREIGN KEY ("cupom_id") REFERENCES "cupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupom_usos" ADD CONSTRAINT "cupom_usos_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupom_usos" ADD CONSTRAINT "cupom_usos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

