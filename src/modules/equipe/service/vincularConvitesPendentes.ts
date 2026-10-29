import type { PrismaClient } from "../../../../generated/prisma/client.js"

/**
 * Consome os convites de funcionário pendentes (#41 — RN01, cadastro
 * silencioso) assim que a pessoa completa o próprio cadastro na plataforma,
 * por e-mail/senha ou Google — ambos os fluxos passam pelo mesmo hook do
 * better-auth (`databaseHooks.user.create.after`, ver src/lib/auth.ts), então
 * esta função não sabe (nem precisa saber) qual dos dois foi usado.
 */
export async function vincularConvitesPendentes(
  prisma: PrismaClient,
  user: { id: string; email: string }
): Promise<void> {
  const convites = await prisma.conviteFuncionario.findMany({
    where: { email: user.email, aceitoEm: null },
  })

  if (convites.length === 0) return

  await prisma.$transaction([
    // upsert (não create): defesa contra o caso raro de o usuário já ter sido
    // vinculado à mesma loja por outro caminho entre o convite e o cadastro.
    ...convites.map((convite) =>
      prisma.membroEstabelecimento.upsert({
        where: {
          userId_estabelecimentoId: { userId: user.id, estabelecimentoId: convite.estabelecimentoId },
        },
        create: { userId: user.id, estabelecimentoId: convite.estabelecimentoId, role: convite.role },
        update: {},
      })
    ),
    prisma.conviteFuncionario.updateMany({
      where: { id: { in: convites.map((c) => c.id) } },
      data: { aceitoEm: new Date() },
    }),
  ])
}
