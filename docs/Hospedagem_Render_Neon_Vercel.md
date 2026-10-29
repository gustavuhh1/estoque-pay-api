# Hospedagem gratuita: Render + Neon + Vercel

> Etapa 5 do plano. Conferido nas páginas oficiais em **29/10/2026**; os limites dos planos gratuitos mudam, então reconfira antes de depender de um número.

## A decisão e o porquê

| Peça | Onde | Limites relevantes (plano gratuito) |
| --- | --- | --- |
| **API** | Render (Docker) | 750 h/mês, sem cartão. **Hiberna após 15 min sem tráfego e leva ~1 min para acordar.** Disco efêmero. Bloqueia saída nas portas SMTP 25/465/587 (o Brevo usa HTTPS, então não afeta). |
| **Banco** | Neon (Postgres) | 1 GB por projeto, 100 CU-h/mês, sem cartão, **permanente** (não é trial). Suspende após 5 min parado. |
| **Front** | Vercel (Hobby) | 100 GB de transferência, 100 deploys/dia. **Uso não comercial** (ok para projeto de faculdade). Faz rewrite/proxy para API externa. |

**Por que não o Postgres da Render:** o gratuito dela **expira em 30 dias** e apaga os dados após 14 dias de carência. **Por que não a Koyeb:** não tem mais serviço web gratuito.

## O risco que define o desenho: cookie entre domínios

O login usa um cookie de sessão `httpOnly`. Se o front fica em `*.vercel.app` e a API em `*.onrender.com`, o navegador os trata como **sites diferentes** e bloqueia o cookie como "de terceiros". Em vez de brigar com isso (`SameSite=None`, CORS com credenciais, navegadores que bloqueiam tudo), o front **faz proxy de `/api` para a API**: para o navegador, tudo vem do domínio do front e o cookie é de primeira parte.

Consequências:
- `BETTER_AUTH_URL`, `BASE_URL` e `APP_URL` são a **URL do front**, não a da API.
- O callback do Google fica na URL do front.
- O **webhook da AbacatePay não passa pelo front**: aponta direto para a API (é servidor para servidor, e o HMAC é do corpo cru, que um proxy não deve tocar).

## Passo a passo

### 1. Neon (banco)

1. Crie uma conta em neon.com e um projeto. Região: **AWS US East 1 (N. Virginia)**, a mesma da Render (`virginia`).
2. Copie a connection string **direta**: a que **não** tem `-pooler` no host. Mantenha `?sslmode=require`. O `prisma migrate deploy`, que roda a cada start, não funciona atrás do pooler.
3. Guarde-a como `DATABASE_URL`. Não commite.

### 2. Render (API)

1. Garanta que o `main` tem o código (ver "Antes de começar" abaixo).
2. Em render.com: **New > Blueprint**, escolha este repositório. Ele lê o [`render.yaml`](../render.yaml).
3. Preencha as variáveis marcadas `sync: false`. Os valores certos estão em [`.env.example`](../.env.example). As que importam agora:
   - `DATABASE_URL`: a do Neon (passo 1).
   - `BETTER_AUTH_URL`, `BASE_URL`, `APP_URL`: a **URL do front** na Vercel (ex.: `https://estoquepay.vercel.app`). Se ainda não existe, crie o projeto na Vercel primeiro só para saber o domínio.
   - `ABACATEPAY_API_KEY`: chave **dev**. **Nunca** a de produção.
   - `ABACATEPAY_WEBHOOK_SECRET`: um segredo longo que você inventa agora (o mesmo vai no painel da AbacatePay).
   - `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`: para o e-mail de redefinir senha e de convite.
   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: só se for usar o login Google.
4. Anote a URL da API (ex.: `https://estoquepay-api.onrender.com`).
5. **Smoke test:** `curl https://estoquepay-api.onrender.com/health` deve devolver `{"status":"ok"}` (a primeira chamada pode demorar ~1 min: é o cold start). Abra `/apidocs` para ver o Swagger.

### 3. Vercel (front): responsabilidade da sessão do front

O front precisa do proxy. Exemplo de `vercel.json` (ajuste o host da API):

```json
{
  "rewrites": [
    { "source": "/api/auth/:path*", "destination": "https://estoquepay-api.onrender.com/api/auth/:path*" },
    { "source": "/api/:path*", "destination": "https://estoquepay-api.onrender.com/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

A API tem dois grupos de rotas: o handler nativo do better-auth em `/api/auth/*` e as rotas do negócio na raiz (`/auth`, `/estabelecimento`, `/produto`...). Por isso são dois rewrites: `/api/auth/*` mantém o prefixo, e `/api/*` o remove. O front chama tudo por `/api/...`, com `credentials: "include"` e o header `x-estabelecimento-id`.

### 4. Login com Google (opcional)

No console do Google, em credenciais OAuth, cadastre:
- **Origem JavaScript autorizada:** a URL do front.
- **URI de redirecionamento:** `https://<front>.vercel.app/api/auth/callback/google`.

### 5. AbacatePay (modo dev)

No painel da AbacatePay (modo dev), crie **um** webhook:
- **URL (endpoint):** `https://<api>.onrender.com/pagamento/webhook/abacatepay`, sem query. A AbacatePay acrescenta sozinha o `webhookSecret=<secret>` em cada entrega, usando o `secret` informado na criação (deve ser igual ao `ABACATEPAY_WEBHOOK_SECRET`). Dá para cadastrar por `POST https://api.abacatepay.com/v2/webhooks/create` (`name`, `endpoint`, `secret`, `events`).
- **Eventos:** `transparent.completed` e os `subscription.*`.
- Uma URL só serve ao Pix e à assinatura.

Se o primeiro aviso chegar com a API hibernada, o timeout de 30 s da AbacatePay pode estourar. Não é perda: ela reenvia (até 7 vezes em ~18 h) e o webhook é idempotente.

**Descobertas que dependem desta etapa** (a documentação deles não deixa claro):
- Qual chave assina o HMAC. O gateway aceita `ABACATEPAY_WEBHOOK_SECRET` e `ABACATEPAY_WEBHOOK_HMAC_KEY`. Se a primeira entrega vier `401`, é a chave: preencha a pública na segunda variável.
- O formato do `data` dos eventos e a data de fim do trial. Faça uma assinatura e um Pix de teste e confira em `GET /billing/assinatura` e `GET /pagamento/pix/:id/status`.

## Antes de começar

1. Os PRs #83 a #87 e o desta etapa precisam estar em `development`.
2. Abrir e mesclar o PR **`development` para `main`** (a `main` é só produção; a Render faz deploy dela). A proteção da `main` pede 2 aprovações do CODEOWNER, então o merge usa `--admin`.
3. Só então criar o Blueprint na Render.

## Cold start e o cenário 17 da validação

A API hiberna após 15 min parada. Para a validação em produção, "acorde" a API antes (`curl /health`) ou aceite ~1 min na primeira tela. Isso é o esperado do plano gratuito e é justamente o que o cenário "API fora do ar / cold start" testa: o front precisa mostrar a tela de erro de rede ou um carregando, em vez de quebrar.

## Segredos

Ficam **só** nos painéis (Render, Neon, Vercel). O `.env` está no `.gitignore` e o `render.yaml` só tem os nomes das variáveis.
