# Yomi Core API

Your Otaku Media Interface — unified anime, manga, doujinshi, theme, and booru API.

## Quick start

```bash
cp .env.example .env
bun install
bun run dev
```

Playground: http://localhost:3000/playground

## Structure

- `apps/server` — Hono gateway
- `packages/shared` — HLS, metadata, cache
- `packages/anime-core` — AniList/Kitsu metadata, AnimeThemes, AniKoto, AniPub
- `packages/manga-core` — MangaFire + WeebCentral + OmegaScans
- `packages/hentai-core` — booru + tag filtering

## Final API

```text
GET /v1/search/universal?q=naruto&includeAdult=true
GET /v1/search/anime?q=naruto
GET /v1/search/manga?q=one%20piece
GET /v1/search/doujinshi?q=naruto
GET /v1/search/imageboards?q=1girl&rating=safe
GET /v1/search/themes?q=naruto
GET /v1/anime/watch?title=naruto&episode=1&category=sub
GET /v1/manga/read?title=one%20piece&chapter=1
```

Universal search excludes adult buckets unless `includeAdult=true`. Anime
playback falls back AniKoto → AniPub → Miruro. Chapter loading falls back
MangaFire → WeebCentral → OmegaScans.

## Tests

```bash
bun test
bun run build
bun run test:e2e
```

Deploy with `bunx vercel`; Vercel loads the root Hono `index.ts` export.
