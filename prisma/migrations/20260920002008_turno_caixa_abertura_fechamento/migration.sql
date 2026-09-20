/*
  Warnings:

  - You are about to drop the column `usuario_id` on the `turnos_caixa` table. All the data in the column will be lost.
  - Added the required column `aberto_por_id` to the `turnos_caixa` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "turnos_caixa" DROP CONSTRAINT "turnos_caixa_usuario_id_fkey";

-- DropIndex
DROP INDEX "turnos_caixa_usuario_id_idx";

-- AlterTable
ALTER TABLE "turnos_caixa" DROP COLUMN "usuario_id",
ADD COLUMN     "aberto_por_id" TEXT NOT NULL,
ADD COLUMN     "fechado_por_id" TEXT;

-- CreateIndex
CREATE INDEX "turnos_caixa_aberto_por_id_idx" ON "turnos_caixa"("aberto_por_id");

-- CreateIndex
CREATE INDEX "turnos_caixa_fechado_por_id_idx" ON "turnos_caixa"("fechado_por_id");

-- AddForeignKey
ALTER TABLE "turnos_caixa" ADD CONSTRAINT "turnos_caixa_aberto_por_id_fkey" FOREIGN KEY ("aberto_por_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos_caixa" ADD CONSTRAINT "turnos_caixa_fechado_por_id_fkey" FOREIGN KEY ("fechado_por_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Escrito a mão: um turno ABERTO por LOJA de cada vez.
-- O Prisma não declara índice único PARCIAL no schema.prisma, então esta linha
-- não é gerada por ele e precisa ser preservada em migrations futuras.
-- A condição WHERE é o ponto: turnos FECHADOS da mesma loja se acumulam à
-- vontade, só o ABERTO é exclusivo.
-- Sem esta trava no banco, dois "abrir caixa" simultâneos passariam os dois
-- pela verificação do service (janela entre ler e gravar).
CREATE UNIQUE INDEX "turnos_caixa_um_aberto_por_loja"
  ON "turnos_caixa" ("estabelecimento_id")
  WHERE "status" = 'ABERTO';
