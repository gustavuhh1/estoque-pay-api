/*
  Warnings:

  - You are about to drop the column `adicionado_em` on the `membros_estabelecimento` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "membros_estabelecimento" DROP COLUMN "adicionado_em",
ADD COLUMN     "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3);
