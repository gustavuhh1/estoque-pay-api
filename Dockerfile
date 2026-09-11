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

ENTRYPOINT ["./docker/entrypoint.sh"]
