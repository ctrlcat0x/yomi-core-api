FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/anime-core/package.json ./packages/anime-core/
COPY packages/manga-core/package.json ./packages/manga-core/
COPY packages/hentai-core/package.json ./packages/hentai-core/

RUN bun install --frozen-lockfile || bun install

COPY . .
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["bun", "run", "start"]
