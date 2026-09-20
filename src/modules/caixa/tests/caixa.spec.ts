import { describe, it, expect, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { NotFoundError, TurnoJaAbertoError } from "@/shared/errors"
import { CaixaService } from "../service/CaixaService"
import { CaixaPrismaRepository } from "../repository/CaixaPrismaRepository"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarUsuario(nome = "Usuário de Teste") {
  return prisma.user.create({
    data: { id: randomUUID(), email: `user-${randomUUID()}@email.com`, name: nome },
  })
}

async function criarEstabelecimento(cnpj = CNPJ_VALIDO) {
  return prisma.estabelecimento.create({ data: { nome: "Loja de Teste", cnpj } })
}

describe("CaixaService", () => {
  let sut: CaixaService

  beforeEach(() => {
    sut = new CaixaService(new CaixaPrismaRepository(prisma))
  })

  describe("abrir (#54 — RF06.1)", () => {
    it("abre registrando quem abriu, o valor e o horário", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario("Quem Abriu")

      const turno = await sut.abrir(loja.id, usuario.id, { valor_abertura: 200 })

      expect(turno.status).toBe("ABERTO")
      expect(turno.aberto_por_id).toBe(usuario.id)
      expect(turno.aberto_por.name).toBe("Quem Abriu")
      expect(Number(turno.valor_abertura)).toBe(200)
      expect(turno.aberto_em).toBeInstanceOf(Date)
      expect(turno.fechado_por_id).toBeNull()
      expect(turno.fechado_em).toBeNull()
      expect(turno.valor_fechamento).toBeNull()
    })

    it("aceita valor de abertura zero (loja que começa sem troco)", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      const turno = await sut.abrir(loja.id, usuario.id, { valor_abertura: 0 })

      expect(Number(turno.valor_abertura)).toBe(0)
    })

    it("bloqueia a segunda abertura na MESMA loja (turno é por loja)", async () => {
      const loja = await criarEstabelecimento()
      const primeiro = await criarUsuario()
      const segundo = await criarUsuario()

      await sut.abrir(loja.id, primeiro.id, { valor_abertura: 100 })

      // Outra pessoa, mesma loja: continua bloqueado. A trava é da loja, não
      // do usuário.
      await expect(
        sut.abrir(loja.id, segundo.id, { valor_abertura: 50 })
      ).rejects.toBeInstanceOf(TurnoJaAbertoError)

      expect(await prisma.turnoCaixa.count()).toBe(1)
    })

    it("a MESMA pessoa pode abrir turno em duas lojas diferentes", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const usuario = await criarUsuario()

      await sut.abrir(loja.id, usuario.id, { valor_abertura: 100 })
      const segundo = await sut.abrir(outraLoja.id, usuario.id, { valor_abertura: 300 })

      expect(segundo.estabelecimento_id).toBe(outraLoja.id)
      expect(await prisma.turnoCaixa.count()).toBe(2)
    })

    it("permite abrir de novo depois que o turno anterior foi fechado", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      await sut.abrir(loja.id, usuario.id, { valor_abertura: 100 })
      await sut.fechar(loja.id, usuario.id, { valor_fechamento: 850 })

      // O índice único é PARCIAL (só sobre status = 'ABERTO'), então turnos
      // FECHADOS da mesma loja se acumulam sem conflito.
      const novo = await sut.abrir(loja.id, usuario.id, { valor_abertura: 120 })

      expect(novo.status).toBe("ABERTO")
      expect(await prisma.turnoCaixa.count()).toBe(2)
    })

    it("o banco barra a abertura simultânea que passou pela checagem do service", async () => {
      const loja = await criarEstabelecimento()
      const a = await criarUsuario()
      const b = await criarUsuario()

      // Dispara as duas em paralelo: as duas leem "nenhum turno aberto" antes
      // de qualquer uma gravar. Sem o índice único parcial no banco, as duas
      // passariam. Uma precisa virar TurnoJaAbertoError (via P2002).
      const resultados = await Promise.allSettled([
        sut.abrir(loja.id, a.id, { valor_abertura: 100 }),
        sut.abrir(loja.id, b.id, { valor_abertura: 200 }),
      ])

      const sucessos = resultados.filter((r) => r.status === "fulfilled")
      const falhas = resultados.filter((r) => r.status === "rejected")

      expect(sucessos).toHaveLength(1)
      expect(falhas).toHaveLength(1)
      expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(TurnoJaAbertoError)
      expect(await prisma.turnoCaixa.count()).toBe(1)
    })
  })

  describe("fechar (#54 — RF06.2)", () => {
    it("fecha registrando o valor final, quem fechou e o horário", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario("Quem Fechou")

      await sut.abrir(loja.id, usuario.id, { valor_abertura: 200 })
      const fechado = await sut.fechar(loja.id, usuario.id, { valor_fechamento: 1250.55 })

      expect(fechado.status).toBe("FECHADO")
      expect(fechado.fechado_por_id).toBe(usuario.id)
      expect(fechado.fechado_por?.name).toBe("Quem Fechou")
      expect(Number(fechado.valor_fechamento)).toBe(1250.55)
      expect(fechado.fechado_em).toBeInstanceOf(Date)
      // O registro da abertura continua intacto.
      expect(Number(fechado.valor_abertura)).toBe(200)
    })

    it("quem fecha pode ser uma pessoa diferente de quem abriu", async () => {
      const loja = await criarEstabelecimento()
      const abriu = await criarUsuario("Maria")
      const fechou = await criarUsuario("João")

      await sut.abrir(loja.id, abriu.id, { valor_abertura: 200 })
      const turno = await sut.fechar(loja.id, fechou.id, { valor_fechamento: 900 })

      expect(turno.aberto_por_id).toBe(abriu.id)
      expect(turno.aberto_por.name).toBe("Maria")
      expect(turno.fechado_por_id).toBe(fechou.id)
      expect(turno.fechado_por?.name).toBe("João")
    })

    it("fechar sem turno aberto lança NotFoundError", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      await expect(
        sut.fechar(loja.id, usuario.id, { valor_fechamento: 100 })
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("não fecha o turno de outra loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const usuario = await criarUsuario()

      await sut.abrir(outraLoja.id, usuario.id, { valor_abertura: 100 })

      await expect(
        sut.fechar(loja.id, usuario.id, { valor_fechamento: 100 })
      ).rejects.toBeInstanceOf(NotFoundError)

      const intacto = await prisma.turnoCaixa.findFirstOrThrow({
        where: { estabelecimento_id: outraLoja.id },
      })
      expect(intacto.status).toBe("ABERTO")
    })
  })

  describe("buscarAberto (#54)", () => {
    it("devolve o turno aberto da loja", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      const aberto = await sut.abrir(loja.id, usuario.id, { valor_abertura: 200 })
      const encontrado = await sut.buscarAberto(loja.id)

      expect(encontrado.id).toBe(aberto.id)
    })

    it("lança NotFoundError quando o caixa está fechado", async () => {
      const loja = await criarEstabelecimento()
      const usuario = await criarUsuario()

      await sut.abrir(loja.id, usuario.id, { valor_abertura: 200 })
      await sut.fechar(loja.id, usuario.id, { valor_fechamento: 500 })

      await expect(sut.buscarAberto(loja.id)).rejects.toBeInstanceOf(NotFoundError)
    })

    it("não vaza o turno aberto de outra loja", async () => {
      const loja = await criarEstabelecimento()
      const outraLoja = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      const usuario = await criarUsuario()

      await sut.abrir(outraLoja.id, usuario.id, { valor_abertura: 100 })

      await expect(sut.buscarAberto(loja.id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
