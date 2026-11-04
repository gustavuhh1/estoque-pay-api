import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import { fotoDoIdToken, preencherFotoDoGoogle } from "../foto"

const FOTO_GOOGLE = "https://lh3.googleusercontent.com/a/foto-de-teste=s96-c"
/** PNG 1x1 em data URI: o menor arquivo válido que o Meu perfil aceita. */
const FOTO_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

/** ID token no formato do Google (só o payload importa: a assinatura não é conferida). */
function idTokenCom(payload: Record<string, unknown>) {
  const parte = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${parte({ alg: "RS256" })}.${parte(payload)}.assinatura`
}

async function vincularGoogle(userId: string, picture: unknown = FOTO_GOOGLE) {
  const ctx = await auth.$context
  return ctx.internalAdapter.linkAccount({
    userId,
    providerId: "google",
    issuer: "https://accounts.google.com",
    accountId: `google-${userId}`,
    idToken: idTokenCom({ sub: `google-${userId}`, picture }),
  })
}

describe("Perfil (RF01.7) - E2E (DB Real)", () => {
  it("401 sem sessão", async () => {
    const response = await app.inject({ method: "GET", url: "/perfil" })
    expect(response.statusCode).toBe(401)
  })

  it("GET devolve dados pessoais, formas de login e as lojas com o cargo", async () => {
    const { user, cookie, email } = await createAuthenticatedUser({ name: "Ana Lima" })
    const loja = await prisma.estabelecimento.create({ data: { nome: "Loja Perfil", cnpj: "11222333000181" } })
    await prisma.membroEstabelecimento.create({ data: { userId: user.id, estabelecimentoId: loja.id, role: "MANAGER" } })

    const response = await app.inject({ method: "GET", url: "/perfil", headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      nome: "Ana Lima",
      email,
      foto: null,
      metodos_login: ["EMAIL"],
      foto_google_disponivel: false,
      lojas: [{ id: loja.id, nome: "Loja Perfil", cargo: "MANAGER" }],
    })
  })

  it("PATCH troca nome e foto, e foto null remove", async () => {
    const { cookie } = await createAuthenticatedUser()

    const salvo = await app.inject({ method: "PATCH", url: "/perfil", headers: { cookie }, payload: { nome: "  Carlos Santos ", foto: FOTO_PNG } })
    expect(salvo.statusCode).toBe(200)
    expect(salvo.json()).toMatchObject({ nome: "Carlos Santos", foto: FOTO_PNG })

    const removido = await app.inject({ method: "PATCH", url: "/perfil", headers: { cookie }, payload: { foto: null } })
    expect(removido.json().foto).toBeNull()
  })

  it.each([
    ["SVG (pode carregar script)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["URL externa", "https://exemplo.com/foto.png"],
    ["texto que não é base64", "data:image/png;base64,isto não é base64"],
    ["acima de ~100 KB", `data:image/png;base64,${"A".repeat(150_000)}`],
  ])("400 para foto inválida: %s", async (_caso, foto) => {
    const { cookie } = await createAuthenticatedUser()
    const response = await app.inject({ method: "PATCH", url: "/perfil", headers: { cookie }, payload: { foto } })
    expect(response.statusCode).toBe(400)
  })

  it("400 com corpo vazio", async () => {
    const { cookie } = await createAuthenticatedUser()
    const response = await app.inject({ method: "PATCH", url: "/perfil", headers: { cookie }, payload: {} })
    expect(response.statusCode).toBe(400)
  })

  it("409 FOTO_GOOGLE_INDISPONIVEL sem conta Google", async () => {
    const { cookie } = await createAuthenticatedUser()
    const response = await app.inject({ method: "POST", url: "/perfil/foto/google", headers: { cookie } })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe("FOTO_GOOGLE_INDISPONIVEL")
  })

  it("POST /perfil/foto/google troca até uma foto enviada pela do Google", async () => {
    const { user, cookie } = await createAuthenticatedUser()
    await prisma.user.update({ where: { id: user.id }, data: { image: FOTO_PNG } })
    await vincularGoogle(user.id)

    const response = await app.inject({ method: "POST", url: "/perfil/foto/google", headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ foto: FOTO_GOOGLE, foto_google_disponivel: true, metodos_login: ["EMAIL", "GOOGLE"] })
  })
})

describe("Foto do Google no login (RF01.7)", () => {
  it("vincular o Google a uma conta sem foto usa a foto do Google", async () => {
    const { user } = await createAuthenticatedUser()
    await vincularGoogle(user.id)
    const atualizado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(atualizado.image).toBe(FOTO_GOOGLE)
  })

  it("não sobrescreve a foto que o usuário já tem", async () => {
    const { user } = await createAuthenticatedUser()
    await prisma.user.update({ where: { id: user.id }, data: { image: FOTO_PNG } })
    await vincularGoogle(user.id)
    const atualizado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(atualizado.image).toBe(FOTO_PNG)
  })

  it("login seguinte (token atualizado) completa a foto de quem ficou sem", async () => {
    const { user } = await createAuthenticatedUser()
    const conta = await vincularGoogle(user.id, null)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).image).toBeNull()

    const ctx = await auth.$context
    await ctx.internalAdapter.updateAccount(conta.id, { idToken: idTokenCom({ picture: FOTO_GOOGLE }) })

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).image).toBe(FOTO_GOOGLE)
  })

  it("ignora foto que não é HTTPS e contas de outro provedor", async () => {
    expect(fotoDoIdToken(idTokenCom({ picture: "javascript:alert(1)" }))).toBeNull()
    expect(fotoDoIdToken(idTokenCom({ picture: "http://inseguro/foto.png" }))).toBeNull()
    expect(fotoDoIdToken("nao-e-jwt")).toBeNull()
    expect(await preencherFotoDoGoogle(prisma, { providerId: "github", userId: "x", idToken: idTokenCom({ picture: FOTO_GOOGLE }) })).toBe(false)
  })
})
