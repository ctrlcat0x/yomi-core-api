import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnimeMetadataSource,
  type AnimeProviderId,
  anikotoProvider,
  animeEpisodes,
  animeInfo,
  animeRelations,
  animeSchedule,
  animeSearch,
  animeSources,
  animeThemeSearch,
  animethemesProvider,
  anipubProvider,
  jikanAnimeInfo,
  jikanAnimeTop,
  jikanSeasonNow,
  kitsuAnimeInfo,
  malAnimeInfo,
  resolveAnimeEpisode,
} from "@yomi/anime-core";
import {
  doujinshiSearch,
  hentaiSearch,
  imageboardSearch,
  listBooruSites,
  parseTagString,
} from "@yomi/hentai-core";
import {
  type MangaProviderId,
  jikanMangaInfo,
  jikanMangaSearch,
  kitsuMangaInfo,
  kitsuMangaSearch,
  mangaPages,
  mangaSearch,
  mangaSeries,
  resolveMangaChapter,
} from "@yomi/manga-core";
import {
  ProviderError,
  config,
  fail,
  handleError,
  imageProxyHints,
  ok,
  proxyHlsRequest,
  proxyImageRequest,
  securityMiddleware,
  telemetryMiddleware,
} from "@yomi/shared";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";

const ANIME_PROVIDERS = ["anikoto", "anipub", "animethemes", "miruro"] as const;
const MANGA_PROVIDERS = ["omegascans", "mangafire", "weebcentral"] as const;

function integerQuery(
  value: string | undefined,
  name: string,
  fallback: number,
  min = 1,
  max = 100,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ProviderError(
      `${name} must be an integer between ${min} and ${max}`,
      422,
    );
  }
  return parsed;
}

function parseAnimeProvider(value: string): AnimeProviderId {
  if (ANIME_PROVIDERS.includes(value as AnimeProviderId))
    return value as AnimeProviderId;
  throw new ProviderError(`provider must be ${ANIME_PROVIDERS.join("|")}`, 422);
}

function parseMangaProvider(
  value: string | undefined,
): MangaProviderId | undefined {
  if (!value) return undefined;
  if (MANGA_PROVIDERS.includes(value as MangaProviderId))
    return value as MangaProviderId;
  throw new ProviderError(`provider must be ${MANGA_PROVIDERS.join("|")}`, 422);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.allowedOrigins,
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["*"],
  }),
);
app.use("*", telemetryMiddleware());
app.use("*", securityMiddleware());

app.get("/health", (c) => c.json(ok({ status: "ok", version: "0.1.0" })));

app.get("/v1/providers", (c) =>
  c.json(
    ok({
      anime: [
        {
          id: "anikoto",
          kind: "scraper",
          tier: "C",
          status: "operational",
          capabilities: ["search", "episodes", "sources"],
        },
        {
          id: "anipub",
          kind: "community-api",
          tier: "C",
          status: "operational",
          capabilities: ["search", "info", "episodes", "sources"],
        },
        {
          id: "animethemes",
          kind: "official-project-api",
          tier: "A",
          status: "operational",
          capabilities: ["search", "info", "themes"],
        },
        {
          id: "miruro",
          kind: "legacy-pipe",
          tier: "C",
          status: "unavailable",
          capabilities: ["episodes", "sources"],
        },
      ],
      manga: [
        {
          id: "weebcentral",
          kind: "scraper",
          status: "operational",
          capabilities: ["search", "series", "chapters", "pages"],
        },
        {
          id: "omegascans",
          kind: "upstream-api",
          status: "operational",
          capabilities: ["search", "series", "chapters", "pages"],
        },
        {
          id: "mangafire",
          kind: "signed-api",
          status: "operational",
          capabilities: ["search", "series", "chapters", "pages"],
        },
      ],
      hentai: [
        {
          id: "booru",
          kind: "multi-site",
          capabilities: ["sites", "search", "posts"],
        },
      ],
    }),
  ),
);

app.get("/openapi.json", (c) =>
  c.json({
    openapi: "3.0.0",
    info: { title: "Yomi Core API", version: "0.1.0" },
    servers: [{ url: "/", description: "Current server" }],
    paths: {
      "/health": { get: { summary: "Health check" } },
      "/v1/providers": { get: { summary: "Provider capability catalog" } },
      "/v1/search": { get: { summary: "Universal search" } },
      "/v1/search/universal": { get: { summary: "Universal search" } },
      "/v1/search/anime": { get: { summary: "AniList-only anime search" } },
      "/v1/search/manga": { get: { summary: "Aggregated manga search" } },
      "/v1/search/imageboards": { get: { summary: "All-booru image search" } },
      "/v1/search/themes": { get: { summary: "Official OP/ED media search" } },
      "/v1/anime/watch": { get: { summary: "Anime episode waterfall" } },
      "/v1/manga/read": { get: { summary: "Manga chapter waterfall" } },
      "/v1/anime/search": { get: { summary: "Anime search" } },
      "/v1/anime/schedule": { get: { summary: "AniList airing schedule" } },
      "/v1/anime/{provider}/info/{id}": {
        get: { summary: "Anime metadata or provider info" },
      },
      "/v1/anime/{provider}/episodes/{id}": {
        get: { summary: "Anime episodes" },
      },
      "/v1/anime/{provider}/sources": {
        get: { summary: "Anime stream sources" },
      },
      "/v1/anime/animethemes/themes/{slug}": {
        get: { summary: "Official anime opening and ending theme media" },
      },
      "/v1/manga/search": { get: { summary: "Manga search" } },
      "/v1/manga/{provider}/series/{id}": {
        get: { summary: "Manga series and chapters" },
      },
      "/v1/manga/{provider}/pages/{id}": {
        get: { summary: "Manga chapter pages" },
      },
      "/v1/hentai/search": { get: { summary: "Hentai/booru search" } },
      "/v1/hentai/sites": { get: { summary: "Supported booru sites" } },
      "/v1/hentai/{site}/posts": {
        get: { summary: "Booru posts by site" },
      },
      "/v1/proxy/hls": { get: { summary: "HLS proxy" } },
      "/v1/proxy/image": { get: { summary: "Image proxy" } },
      "/playground": { get: { summary: "Test playground UI" } },
    },
  }),
);

app.get("/playground", (c) => {
  const html = readFileSync(
    join(process.cwd(), "apps", "server", "src", "playground", "index.html"),
    "utf-8",
  );
  return c.html(html);
});

app.get("/docs", (c) => c.redirect("/playground"));

async function universalSearch(c: Context) {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const legacyTypes = c.req
      .query("types")
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (legacyTypes) {
      const invalid = legacyTypes.find(
        (type) => !["anime", "manga", "hentai"].includes(type),
      );
      if (invalid) return c.json(fail(`Unsupported type: ${invalid}`), 422);
      const enabled = new Set(legacyTypes);
      const [anime, manga, hentai] = await Promise.allSettled([
        enabled.has("anime")
          ? animeSearch(q, page, 20, "anilist")
          : Promise.resolve(null),
        enabled.has("manga") ? mangaSearch(q, page) : Promise.resolve(null),
        enabled.has("hentai")
          ? hentaiSearch({ q, page: page - 1, limit: 20 })
          : Promise.resolve(null),
      ]);
      const legacyResults = {
        anime: anime.status === "fulfilled" ? (anime.value?.results ?? []) : [],
        manga: manga.status === "fulfilled" ? (manga.value?.results ?? []) : [],
        hentai:
          hentai.status === "fulfilled" ? (hentai.value?.posts ?? []) : [],
      };
      return c.json(
        ok(legacyResults, {
          page,
          perPage: 20,
          total:
            legacyResults.anime.length +
            legacyResults.manga.length +
            legacyResults.hentai.length,
        }),
      );
    }
    const includeAdult = c.req.query("includeAdult") === "true";
    const [anime, manga, doujinshi, imageboards] = await Promise.allSettled([
      animeSearch(q, page, 20, "anilist"),
      mangaSearch(q, page),
      includeAdult ? doujinshiSearch(q, page) : Promise.resolve(null),
      includeAdult
        ? imageboardSearch({ q, page: page - 1, limit: 3 })
        : Promise.resolve(null),
    ]);
    const results = {
      anime: anime.status === "fulfilled" ? anime.value.results : [],
      manga: manga.status === "fulfilled" ? manga.value.results : [],
      doujinshi:
        doujinshi.status === "fulfilled"
          ? (doujinshi.value?.results ?? [])
          : [],
      imageboards:
        imageboards.status === "fulfilled"
          ? (imageboards.value?.posts ?? [])
          : [],
      sourceStatus: {
        anime: anime.status,
        manga: manga.status,
        doujinshi: includeAdult ? doujinshi.status : "filtered",
        imageboards: includeAdult ? imageboards.status : "filtered",
      },
    };
    return c.json(
      ok(results, {
        page,
        perPage: 20,
        total:
          results.anime.length +
          results.manga.length +
          results.doujinshi.length +
          results.imageboards.length,
        includeAdult,
      }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
}

app.get("/v1/search", universalSearch);
app.get("/v1/search/universal", universalSearch);

app.get("/v1/search/anime", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const perPage = integerQuery(c.req.query("perPage"), "perPage", 20, 1, 50);
    const data = await animeSearch(q, page, perPage, "anilist");
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
        source: "anilist",
      }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/search/manga", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const data = await mangaSearch(q, page);
    return c.json(
      ok(data.results, { ...data.pagination, sources: data.sources }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/search/imageboards", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 0, 0, 10000);
    const limit = integerQuery(c.req.query("limit"), "limit", 5, 1, 20);
    const data = await imageboardSearch({
      q,
      page,
      limit,
      rating: c.req.query("rating") ?? undefined,
    });
    return c.json(
      ok(data.posts, {
        page,
        perSource: limit,
        sources: data.sources,
        totalSources: data.totalSources,
        successfulSources: data.successfulSources,
      }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/search/themes", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const limit = integerQuery(c.req.query("limit"), "limit", 5, 1, 10);
    const data = await animeThemeSearch(q, limit);
    return c.json(
      ok(data.results, {
        total: data.total,
        source: data.provider,
        sources: data.sources,
      }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/search/doujinshi", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const data = await doujinshiSearch(q, page);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
        source: data.source,
      }),
    );
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

// Proxy routes
function streamHeadersForUrl(url: string): Record<string, string> {
  const hostname = new URL(url).hostname;
  const origin = hostname.endsWith("vidtub.kotocdn.site")
    ? "https://vidtube.site"
    : hostname.endsWith("megap.kotocdn.site")
      ? "https://megaplay.buzz"
      : hostname.endsWith("watching.onl")
        ? "https://vidwish.live"
        : null;
  if (!origin) return { ...config.streamHeaders };
  return {
    ...config.streamHeaders,
    Origin: origin,
    Referer: `${origin}/`,
  };
}

app.get("/v1/proxy/hls", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json(fail("url is required"), 422);

  try {
    new URL(url);
  } catch {
    return c.json(fail("Invalid URL"), 400);
  }

  try {
    const range = c.req.header("range") ?? null;
    const result = await proxyHlsRequest(url, streamHeadersForUrl(url), range);
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      "Content-Type": result.contentType,
      ...result.extraHeaders,
    };
    return c.body(result.body, result.status as 200, headers);
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 502);
  }
});

app.get("/v1/proxy/image", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json(fail("url is required"), 422);
  const referer = c.req.query("referer");

  try {
    const width = c.req.query("w")
      ? integerQuery(c.req.query("w"), "w", 0, 1, 4096)
      : undefined;
    const quality = c.req.query("q")
      ? integerQuery(c.req.query("q"), "q", 0, 1, 100)
      : undefined;
    const headers = referer ? { Referer: referer } : undefined;
    const result = await proxyImageRequest(url, { width, quality, headers });
    return c.body(result.body, 200, {
      "Content-Type": result.contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      ...imageProxyHints({ width, quality }),
    });
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 502);
  }
});

// Anime routes
app.get("/v1/anime/providers", (c) =>
  c.json(ok([...ANIME_PROVIDERS], undefined)),
);

app.get("/v1/anime/watch", async (c) => {
  const title = c.req.query("title") ?? c.req.query("q");
  if (!title) return c.json(fail("title is required"), 422);
  try {
    const episode = integerQuery(
      c.req.query("episode"),
      "episode",
      0,
      1,
      100000,
    );
    const category = c.req.query("category") ?? "sub";
    if (!["sub", "dub", "raw"].includes(category))
      return c.json(fail("category must be sub|dub|raw"), 422);
    return c.json(ok(await resolveAnimeEpisode(title, episode, category)));
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/search", async (c) => {
  const q = c.req.query("q");
  const source = (c.req.query("source") ?? "anilist") as AnimeMetadataSource;
  if (!q) return c.json(fail("q is required"), 422);
  if (
    !["anilist", "jikan", "kitsu", "mal", "anipub", "animethemes"].includes(
      source,
    )
  ) {
    return c.json(
      fail("source must be anilist|jikan|kitsu|mal|anipub|animethemes"),
      422,
    );
  }

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const perPage = integerQuery(c.req.query("perPage"), "perPage", 20, 1, 50);
    const data = await animeSearch(q, page, perPage, source);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
        source,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/anikoto/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);

  try {
    const data = await anikotoProvider.search(q);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/anipub/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const perPage = integerQuery(c.req.query("perPage"), "perPage", 20, 1, 50);
    const data = await anipubProvider.search(q, page, perPage);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
        source: data.source,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/animethemes/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const perPage = integerQuery(c.req.query("perPage"), "perPage", 20, 1, 50);
    const data = await animethemesProvider.search(q, page, perPage);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
        source: data.source,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/animethemes/themes/:slug", async (c) => {
  try {
    const data = await animethemesProvider.getThemes(c.req.param("slug"));
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/anikoto/trending", async (c) => {
  try {
    const data = await anikotoProvider.getTrending();
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/anikoto/popular", async (c) => {
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const data = await anikotoProvider.getPopular(page);
    return c.json(
      ok(data.data, { page: data.page, totalPages: data.totalPages }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/anikoto/schedule", async (c) => {
  const date = c.req.query("date");
  if (!date) return c.json(fail("date is required (YYYY-MM-DD)"), 422);
  if (!isIsoDate(date)) {
    return c.json(fail("date must be YYYY-MM-DD"), 422);
  }

  try {
    const data = await anikotoProvider.getSchedule(date);
    if (data.length) return c.json(ok(data, { date, source: "anikoto" }));

    const fallback = await animeSchedule(date);
    return c.json(
      ok(fallback.results, {
        date,
        source: "anilist",
        page: fallback.page,
        perPage: fallback.perPage,
        total: fallback.total,
        hasNextPage: fallback.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/schedule", async (c) => {
  const date = c.req.query("date");
  if (!date || !isIsoDate(date))
    return c.json(fail("date must be YYYY-MM-DD"), 422);

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const perPage = integerQuery(c.req.query("perPage"), "perPage", 50, 1, 50);
    const data = await animeSchedule(date, page, perPage);
    return c.json(
      ok(data.results, {
        date,
        source: "anilist",
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/jikan/top", async (c) => {
  const filter = c.req.query("filter") ?? undefined;
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 25);
    const data = await jikanAnimeTop(page, limit, filter);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/jikan/season", async (c) => {
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 25);
    const data = await jikanSeasonNow(page, limit);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/jikan/:malId", async (c) => {
  try {
    const malId = integerQuery(
      c.req.param("malId"),
      "malId",
      0,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const data = await jikanAnimeInfo(malId);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/kitsu/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const data = await kitsuAnimeInfo(id);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/mal/:malId", async (c) => {
  try {
    const malId = integerQuery(
      c.req.param("malId"),
      "malId",
      0,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const data = await malAnimeInfo(malId);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/metadata/:anilistId/relations", async (c) => {
  try {
    const anilistId = integerQuery(
      c.req.param("anilistId"),
      "anilistId",
      0,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const data = await animeRelations(anilistId);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/:provider/info/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const provider = parseAnimeProvider(c.req.param("provider"));
    if (provider === "miruro") {
      const anilistId = integerQuery(id, "id", 0, 1, Number.MAX_SAFE_INTEGER);
      const data = await animeInfo(anilistId);
      return c.json(ok(data));
    }
    const data =
      provider === "anipub"
        ? await anipubProvider.getInfo(id)
        : provider === "animethemes"
          ? await animethemesProvider.getInfo(id)
          : await anikotoProvider.getInfo(id);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/:provider/episodes/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const provider = parseAnimeProvider(c.req.param("provider"));
    if (provider === "miruro") {
      integerQuery(id, "id", 0, 1, Number.MAX_SAFE_INTEGER);
    }
    const data = await animeEpisodes(provider, id);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/:provider/sources", async (c) => {
  try {
    const provider = c.req.param("provider");
    if (ANIME_PROVIDERS.includes(provider as AnimeProviderId))
      parseAnimeProvider(provider);
    const anilistId = c.req.query("anilistId")
      ? integerQuery(
          c.req.query("anilistId"),
          "anilistId",
          0,
          1,
          Number.MAX_SAFE_INTEGER,
        )
      : undefined;
    const data = await animeSources(provider, {
      episodeId: c.req.query("episodeId"),
      serverIds: c.req.query("serverIds"),
      anilistId,
      category: c.req.query("category") ?? "sub",
      slug: c.req.query("slug"),
      streamProvider: c.req.query("streamProvider") ?? undefined,
    });
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/anime/:provider/watch/:anilistId/:category/:slug", async (c) => {
  const provider = c.req.param("provider");
  try {
    const anilistId = integerQuery(
      c.req.param("anilistId"),
      "anilistId",
      0,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const data = await animeSources(provider, {
      anilistId,
      category: c.req.param("category"),
      slug: c.req.param("slug"),
    });
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

// Manga routes
app.get("/v1/manga/providers", (c) => c.json(ok([...MANGA_PROVIDERS])));

app.get("/v1/manga/read", async (c) => {
  const title = c.req.query("title") ?? c.req.query("q");
  const chapter = c.req.query("chapter");
  if (!title || !chapter)
    return c.json(fail("title and chapter are required"), 422);
  try {
    return c.json(ok(await resolveMangaChapter(title, chapter)));
  } catch (error) {
    const { status, message } = handleError(error);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);

  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const provider = parseMangaProvider(c.req.query("provider"));
    const data = await mangaSearch(q, page, provider);
    return c.json(ok(data.results, data.pagination));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/jikan/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 25);
    const data = await jikanMangaSearch(q, page, limit);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/jikan/:malId", async (c) => {
  try {
    const malId = integerQuery(
      c.req.param("malId"),
      "malId",
      0,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const data = await jikanMangaInfo(malId);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/kitsu/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json(fail("q is required"), 422);
  try {
    const page = integerQuery(c.req.query("page"), "page", 1, 1, 1000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 20);
    const data = await kitsuMangaSearch(q, page, limit);
    return c.json(
      ok(data.results, {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      }),
    );
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/kitsu/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const data = await kitsuMangaInfo(id);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/:provider/series/:id{.+}", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const includeChapters = c.req.query("include") === "chapters";

  try {
    const provider = parseMangaProvider(c.req.param("provider"));
    if (!provider) throw new ProviderError("provider is required", 422);
    const data = await mangaSeries(provider, id, includeChapters);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/:provider/pages/:id{.+}", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const parts = id.split("/");
  const seriesSlug = parts[0] ?? id;
  const chapterSlug = parts[1];

  try {
    const provider = parseMangaProvider(c.req.param("provider"));
    if (!provider) throw new ProviderError("provider is required", 422);
    const data = await mangaPages(provider, seriesSlug, chapterSlug);
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/manga/:provider/chapters/:id{.+}", async (c) => {
  const id = c.req.param("id");

  try {
    const provider = parseMangaProvider(c.req.param("provider"));
    if (!provider) throw new ProviderError("provider is required", 422);
    const series = await mangaSeries(provider, id, true);
    return c.json(ok(series.chapters));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

// Hentai routes
app.get("/v1/hentai/search", async (c) => {
  const q = c.req.query("q");
  const site = c.req.query("site") ?? "danbooru";
  const tags = q ? parseTagString(q) : undefined;

  try {
    const page = integerQuery(c.req.query("page"), "page", 0, 0, 10000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 100);
    const blocked = (c.req.queries("blocked") ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean) as Parameters<typeof hentaiSearch>[0]["blocked"];
    const data = await hentaiSearch({
      site,
      tags,
      q,
      page,
      limit,
      rating: c.req.query("rating") ?? undefined,
      blocked,
      random: c.req.query("random") === "true",
    });
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/hentai/:site/posts", async (c) => {
  const site = c.req.param("site");
  const q = c.req.query("tags") ?? c.req.query("q") ?? "";

  try {
    const page = integerQuery(c.req.query("page"), "page", 0, 0, 10000);
    const limit = integerQuery(c.req.query("limit"), "limit", 20, 1, 100);
    const data = await hentaiSearch({
      site,
      tags: q ? parseTagString(q) : [],
      page,
      limit,
    });
    return c.json(ok(data));
  } catch (err) {
    const { status, message } = handleError(err);
    return c.json(fail(message), status as 500);
  }
});

app.get("/v1/hentai/sites", (c) => c.json(ok(listBooruSites())));

app.get("/v1/hentai/videos/*", (c) =>
  c.json(fail("Hentai video streaming is not implemented"), 501),
);

app.onError((err, c) => {
  const { status, message } = handleError(err);
  return c.json(fail(message), status as 500);
});

app.notFound((c) => c.json(fail("Not Found"), 404));

export default app;
