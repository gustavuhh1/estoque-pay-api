-- CreateTable
CREATE TABLE "convites_funcionario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "estabelecimentoId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aceitoEm" TIMESTAMP(3),

    CONSTRAINT "convites_funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "convites_funcionario_email_idx" ON "convites_funcionario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "convites_funcionario_email_estabelecimentoId_key" ON "convites_funcionario"("email", "estabelecimentoId");

-- AddForeignKey
ALTER TABLE "convites_funcionario" ADD CONSTRAINT "convites_funcionario_estabelecimentoId_fkey" FOREIGN KEY ("estabelecimentoId") REFERENCES "estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_funcionario" ADD CONSTRAINT "convites_funcionario_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
