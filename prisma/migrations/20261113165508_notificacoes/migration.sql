-- Notificações da loja (sininho do painel). Migração ADITIVA: só cria o enum,
-- a tabela e os índices; não altera nada existente.

-- CreateEnum
CREATE TYPE "TipoNotificacao" AS ENUM ('ESTOQUE_BAIXO', 'ESTOQUE_ZERADO', 'VENDA_CANCELADA', 'PIX_CONFIRMADO', 'CAIXA_DIFERENCA');

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "estabelecimento_id" TEXT NOT NULL,
    "tipo" "TipoNotificacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "link" TEXT,
    "chave" TEXT,
    "lida_em" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notificacoes_estabelecimento_id_criada_em_idx" ON "notificacoes"("estabelecimento_id", "criada_em");

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Escrito a mão: deduplicação de avisos NÃO LIDOS por loja.
-- O Prisma não declara índice único PARCIAL no schema.prisma, então esta linha
-- não é gerada por ele e precisa ser preservada em migrations futuras.
-- Enquanto houver um "estoque baixo: Arroz" não lido, uma nova venda do arroz
-- não cria outro; depois de lido, a mesma chave pode voltar a notificar.
-- Notificações sem chave (NULL) nunca colidem.
CREATE UNIQUE INDEX "notificacoes_chave_nao_lida"
  ON "notificacoes" ("estabelecimento_id", "chave")
  WHERE "lida_em" IS NULL;
