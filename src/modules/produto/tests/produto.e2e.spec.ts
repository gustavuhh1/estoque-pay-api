import { describe, it, expect } from "vitest"
import { app } from "@/app"
import { prisma } from "@/lib/prisma"
import { createAuthenticatedUser } from "@/shared/tests/create-authenticated-user"
import type { Role } from "../../../../generated/prisma/client.js"

const CNPJ_VALIDO = "11222333000181"
const OUTRO_CNPJ_VALIDO = "11444777000161"

async function criarEstabelecimento(cnpj = CNPJ_VALIDO, emiteNfce = false) {
  return prisma.estabelecimento.create({
    data: { nome: "Loja de Teste", cnpj, emite_nfce: emiteNfce },
  })
}

async function criarMembro(userId: string, estabelecimentoId: string, role: Role) {
  return prisma.membroEstabelecimento.create({
    data: { userId, estabelecimentoId, role },
  })
}

async function criarProdutoDireto(
  estabelecimentoId: string,
  overrides: Partial<{ ean_gtin: string | null; ncm: string | null; cfop: string | null; ativo: boolean }> = {}
) {
  return prisma.produto.create({
    data: {
      estabelecimento_id: estabelecimentoId,
      nome: "Produto de Teste",
      ean_gtin: overrides.ean_gtin ?? null,
      preco_custo: 5,
      preco_venda: 10,
      quantidade_atual: 100,
      ncm: overrides.ncm ?? null,
      cfop: overrides.cfop ?? null,
      ativo: overrides.ativo ?? true,
    },
  })
}

const CORPO_BASE = {
  nome: "Refrigerante Lata",
  tipo_medida: "UNIDADE" as const,
  preco_custo: 3,
  preco_venda: 6,
  quantidade_atual: 10,
  quantidade_minima: 0,
}

describe("Produto Module - E2E (DB Real)", () => {
  describe("POST /produto (#43)", () => {
    it("201 — cria o produto ativo quando a loja não emite NFC-e", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, false)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().ativo).toBe(true)
    })

    it("201 — estoque inicial aparece no histórico como entrada de quem cadastrou (RN05)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, false)
      await criarMembro(user.id, loja.id, "OWNER")
      const headers = { cookie, "x-estabelecimento-id": loja.id }

      const criado = await app.inject({ method: "POST", url: "/produto", headers, payload: { ...CORPO_BASE, quantidade_atual: 24 } })
      expect(criado.statusCode).toBe(201)
      expect(criado.json().quantidade_atual).toBe(24)

      const historico = await app.inject({ method: "GET", url: `/estoque/movimentacoes?produto_id=${criado.json().id}`, headers })
      expect(historico.statusCode).toBe(200)
      expect(historico.json().total).toBe(1)
      expect(historico.json().data[0]).toMatchObject({ tipo: "ENTRADA", motivo: "REABASTECIMENTO", quantidade: 24, observacao: "Estoque inicial" })
    })

    it("201 — RN09.1: nasce inativo se faltar NCM/CFOP com NFC-e ligada, sem erro", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().ativo).toBe(false)
    })

    it("403 — CASHIER não pode criar produto", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "CASHIER")

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_PRODUCTS")
    })

    it("409 — código de barras já cadastrado na loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      await criarProdutoDireto(loja.id, { ean_gtin: "7890000000010" })

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { ...CORPO_BASE, ean_gtin: "7890000000010" },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe("EAN_GTIN_ALREADY_IN_USE")
    })

    it("400 — preço de venda inválido (<=0)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { ...CORPO_BASE, preco_venda: 0 },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("VALIDATION_ERROR")
    })

    it("400 — sem o header x-estabelecimento-id", async () => {
      const { cookie } = await createAuthenticatedUser()

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe("TENANT_HEADER_REQUIRED")
    })

    it("401 — sem sessão", async () => {
      const loja = await criarEstabelecimento(CNPJ_VALIDO)

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { "x-estabelecimento-id": loja.id },
        payload: CORPO_BASE,
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe("GET /produto (#44)", () => {
    it("200 — lista só os produtos da loja ativa", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      await criarProdutoDireto(lojaA.id)
      await criarProdutoDireto(lojaB.id)

      const response = await app.inject({
        method: "GET",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveLength(1)
    })

    it("403 — sem vínculo com a loja do header", async () => {
      const { cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)

      const response = await app.inject({
        method: "GET",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("TENANT_ACCESS_DENIED")
    })
  })

  describe("PATCH /produto/:id (#44)", () => {
    it("200 — edita os campos e persiste", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { nome: "Nome Editado" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().nome).toBe("Nome Editado")
    })

    it("404 — produto pertence a outra loja", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const lojaA = await criarEstabelecimento(CNPJ_VALIDO)
      const lojaB = await criarEstabelecimento(OUTRO_CNPJ_VALIDO)
      await criarMembro(user.id, lojaA.id, "OWNER")
      const produtoDaLojaB = await criarProdutoDireto(lojaB.id)

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produtoDaLojaB.id}`,
        headers: { cookie, "x-estabelecimento-id": lojaA.id },
        payload: { nome: "Invasão" },
      })

      expect(response.statusCode).toBe(404)
    })

    it("400 — body vazio", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe("Foto do produto (imagem_url)", () => {
    const FOTO_PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

    it("201 — cadastra com foto e devolve imagem_url no cadastro e na listagem", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const headers = { cookie, "x-estabelecimento-id": loja.id }

      const criado = await app.inject({
        method: "POST",
        url: "/produto",
        headers,
        payload: { ...CORPO_BASE, imagem_url: FOTO_PNG },
      })
      expect(criado.statusCode).toBe(201)
      expect(criado.json().imagem_url).toBe(FOTO_PNG)

      const lista = await app.inject({ method: "GET", url: "/produto", headers })
      expect(lista.json()[0].imagem_url).toBe(FOTO_PNG)
    })

    it("200 — troca a foto na edição e remove com imagem_url: null", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)
      const headers = { cookie, "x-estabelecimento-id": loja.id }

      const comFoto = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}`,
        headers,
        payload: { imagem_url: FOTO_PNG },
      })
      expect(comFoto.statusCode).toBe(200)
      expect(comFoto.json().imagem_url).toBe(FOTO_PNG)

      const semFoto = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}`,
        headers,
        payload: { imagem_url: null },
      })
      expect(semFoto.statusCode).toBe(200)
      expect(semFoto.json().imagem_url).toBeNull()
      expect((await prisma.produto.findUnique({ where: { id: produto.id } }))?.imagem_url).toBeNull()
    })

    it.each([
      ["URL externa", "https://exemplo.com/foto.png"],
      ["SVG (pode carregar script)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
      ["acima de ~100 KB", `data:image/png;base64,${"A".repeat(150_000)}`],
    ])("400 — recusa foto inválida: %s", async (_caso, imagem_url) => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "POST",
        url: "/produto",
        headers: { cookie, "x-estabelecimento-id": loja.id },
        payload: { ...CORPO_BASE, imagem_url },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe("DELETE /produto/:id (#44)", () => {
    it("204 — exclui produto nunca vendido (hard delete)", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "DELETE",
        url: `/produto/${produto.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(204)
      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(noBanco).toBeNull()
    })

    it("204 — exclui (soft delete) produto já vendido, preservando o histórico", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id)
      const venda = await prisma.venda.create({
        data: {
          estabelecimento_id: loja.id,
          usuario_id: user.id,
          total_venda: 10,
          metodo_pagamento: "DINHEIRO",
          status_pagamento: "PAGO",
        },
      })
      await prisma.itemVenda.create({
        data: { venda_id: venda.id, produto_id: produto.id, quantidade: 1, preco_unitario: 10, subtotal: 10 },
      })

      const response = await app.inject({
        method: "DELETE",
        url: `/produto/${produto.id}`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(204)
      const noBanco = await prisma.produto.findUnique({ where: { id: produto.id } })
      expect(noBanco).not.toBeNull()
      expect(noBanco?.deletado_em).not.toBeNull()
    })

    it("404 — produto inexistente", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "OWNER")

      const response = await app.inject({
        method: "DELETE",
        url: "/produto/00000000-0000-0000-0000-000000000000",
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe("PATCH /produto/:id/inativar e /reativar (#45)", () => {
    it("200 — inativar sempre funciona, mesmo com NFC-e ligada e sem NCM/CFOP", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { ativo: true })

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}/inativar`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().ativo).toBe(false)
    })

    it("200 — reativar funciona quando NCM/CFOP estão preenchidos", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, {
        ativo: false,
        ncm: "22021000",
        cfop: "5102",
      })

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}/reativar`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().ativo).toBe(true)
    })

    it("403 — RN09.2 bloqueia reativação sem NCM/CFOP com NFC-e ligada", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO, true)
      await criarMembro(user.id, loja.id, "OWNER")
      const produto = await criarProdutoDireto(loja.id, { ativo: false })

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}/reativar`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("PRODUTO_SEM_CONFORMIDADE_FISCAL")
    })

    it("403 — CASHIER não pode inativar/reativar", async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const loja = await criarEstabelecimento(CNPJ_VALIDO)
      await criarMembro(user.id, loja.id, "CASHIER")
      const produto = await criarProdutoDireto(loja.id)

      const response = await app.inject({
        method: "PATCH",
        url: `/produto/${produto.id}/inativar`,
        headers: { cookie, "x-estabelecimento-id": loja.id },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe("ROLE_CANNOT_MANAGE_PRODUCTS")
    })
  })
})
