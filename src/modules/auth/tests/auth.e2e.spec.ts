import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { prisma } from "@/lib/prisma";

describe("Auth Module - E2E (DB Real)", () => {
  it("Deve registrar um usuário com sucesso (POST /auth/register)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "teste2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.message).toBe("Usuário criado com sucesso");
    expect(json.user.id).toBeDefined();

    // Verifica no BD se o usuário realmente foi criado
    const userInDb = await prisma.user.findUnique({
      where: { email: "teste2e@email.com" },
    });
    expect(userInDb).not.toBeNull();
  });

  it("Deve retornar erro 409 se o usuário já existir no banco (POST /auth/register)", async () => {
    // Primeiro request funciona
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "conflito@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    // Segundo request falha
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "conflito@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json();
    expect(json.code).toBe("EMAIL_ALREADY_IN_USE");
    expect(json.message).toBe("Este e-mail já está cadastrado.");
    expect(json.details.field).toBe("email");
    expect(json.requestId).toBeDefined();
  });

  it("Deve retornar 409 (e nunca 500) em registros simultâneos do mesmo e-mail", async () => {
    // Corrida: os dois requests passam pelo pré-check antes de qualquer insert,
    // então o conflito precisa ser tratado também no better-auth/Prisma.
    const payload = {
      email: "corrida@email.com",
      name: "Test E2E",
      password: "password123",
    };

    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/auth/register", payload }),
      app.inject({ method: "POST", url: "/auth/register", payload }),
    ]);

    const statusCodes = responses.map((response) => response.statusCode).sort();
    expect(statusCodes).toEqual([201, 409]);

    const conflict = responses.find((response) => response.statusCode === 409);
    expect(conflict?.json().code).toBe("EMAIL_ALREADY_IN_USE");
  });

  it("Deve realizar login com sucesso (POST /auth/login)", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "login_e2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "login_e2e@email.com",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.message).toBe("Login realizado com sucesso");
    expect(json.user.id).toBeDefined();
  });

  it("Deve devolver o cookie de sessão no login, utilizável em rota protegida", async () => {
    // Sem o Set-Cookie aqui o login é inútil na prática: o cliente autentica e
    // mesmo assim toma 401 em qualquer rota protegida por requireAuth.
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "sessao_e2e@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "sessao_e2e@email.com", password: "password123" },
    });

    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    expect(setCookie).toBeDefined();

    const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((item) => String(item).split(";")[0])
      .join("; ");

    const protegida = await app.inject({
      method: "POST",
      url: "/estabelecimento",
      headers: { cookie },
      payload: { nome: "Loja Pós-Login", cnpj: "11222333000181" },
    });

    console.log("Cookie salvo:", cookie);

    expect(protegida.statusCode).toBe(201);
  });

  it("Deve retornar erro 401 ao logar com usuário inexistente (POST /auth/login)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "inexistente_e2e@email.com",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(401);
    const json = response.json();
    expect(json.message).toBe("Credenciais inválidas");
  });

  it("Deve retornar erro 401 ao logar com senha incorreta (POST /auth/login)", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "senha_errada@email.com",
        name: "Test E2E",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "senha_errada@email.com",
        password: "senha_totalmente_errada",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("Deve retornar erro 400 (Bad Request) se faltarem campos no registro", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "invalido", // Email inválido, falta senha
      },
    });

    // O schema da rota rejeita antes do handler; o error-handler traduz.
    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details.issues.length).toBeGreaterThan(0);
    expect(json.details.issues.map((issue: { field: string }) => issue.field)).toContain(
      "email",
    );
  });

  it("Deve retornar erro 400 (e nunca 500) com JSON malformado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "content-type": "application/json" },
      payload: "{invalido",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().requestId).toBeDefined();
  });
});
