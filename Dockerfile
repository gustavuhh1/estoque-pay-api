# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsup.config.ts prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

# Imagem "tools": Prisma CLI pronto pra rodar Studio (UI de dados) contra o
# banco. Não é usada pela API - só pelo serviço opcional "studio" do compose.
FROM deps AS tools
WORKDIR /app
RUN apk add --no-cache openssl
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
RUN apk update && apk upgrade --no-cache && apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 3333

# Healthcheck pelo GET /health (SELECT 1 no banco). `wget` vem no busybox do
# alpine; a hospedagem pode usar o mesmo endpoint. O start-period dá tempo ao
# `prisma migrate deploy` do entrypoint antes de o container contar como doente.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3333}/health" || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]
