/**
 * Live E2E smoke against a running Yomi Core API.
 *
 *   PORT=3001 bun run scripts/e2e-smoke.ts
 *   BASE_URL=http://127.0.0.1:3001 bun run scripts/e2e-smoke.ts
 *
 * Expected upstream flakes (CF 403, Jikan 5xx, Miruro pipe down) → SKIP/WARN, not FAIL.
 */

const BASE = (
  process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`
).replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 25_000);
const TODAY = new Date().toISOString().slice(0, 10);

type Status = "PASS" | "FAIL" | "SKIP" | "WARN";

interface Row {
  area: string;
  flow: string;
  result: Status;
  ms: number;
  notes: string;
}

const rows: Row[] = [];

function isTransient(status: number, body: string): boolean {
  if ([403, 429, 502, 503, 504].includes(status)) return true;
  const t = body.toLowerCase();
  // API often wraps upstream codes as HTTP 500 + "Jikan HTTP 504" / "MangaKakalot HTTP 403"
  if (
    /\bhttps?\s+\b(403|429|502|503|504)\b/i.test(body) ||
    /\bHTTP (403|429|502|503|504)\b/i.test(body)
  ) {
    return true;
  }
  return (
    t.includes("cloudflare") ||
    t.includes("just a moment") ||
    t.includes("rate limit") ||
    t.includes("timeout") ||
    t.includes("timed out") ||
    t.includes("econnreset") ||
    t.includes("fetch failed") ||
    t.includes("unreachable") ||
    t.includes("temporarily unavailable")
  );
}

function directHlsUrls(data: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (/^https?:\/\/.+\.m3u8(?:[?#].*)?$/i.test(value)) urls.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(data);
  return [...urls];
}

function pageImageCount(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  const pages = (d.pages ?? d.images ?? d) as unknown;
  if (Array.isArray(pages)) {
    return pages.filter((p) => {
      if (typeof p === "string") return /^https?:\/\//.test(p);
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        return typeof (o.url ?? o.img ?? o.src) === "string";
      }
      return false;
    }).length;
  }
  return 0;
}

function arrayLen(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.results)) return d.results.length;
    if (Array.isArray(d.posts)) return d.posts.length;
    if (Array.isArray(d.data)) return d.data.length;
    if (Array.isArray(d.episodes)) return d.episodes.length;
    if (Array.isArray(d.chapters)) return d.chapters.length;
    if (Array.isArray(d.mangas)) return d.mangas.length;
  }
  return 0;
}

async function get(
  path: string,
  opts?: { timeoutMs?: number },
): Promise<{
  status: number;
  json: any;
  raw: string;
  ms: number;
  ok: boolean;
}> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    const raw = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    return { status: res.status, json, raw, ms: Date.now() - t0, ok: res.ok };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      json: null,
      raw: msg,
      ms: Date.now() - t0,
      ok: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getExternal(
  url: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  contentType: string;
  bytes: Uint8Array;
  text: string;
  ms: number;
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes,
      text: new TextDecoder().decode(bytes.slice(0, 4096)),
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function record(
  area: string,
  flow: string,
  result: Status,
  ms: number,
  notes: string,
): void {
  rows.push({ area, flow, result, ms, notes });
  const icon =
    result === "PASS"
      ? "✓"
      : result === "FAIL"
        ? "✗"
        : result === "WARN"
          ? "!"
          : "·";
  console.log(`${icon} [${result}] ${area} | ${flow} (${ms}ms) — ${notes}`);
}

async function checkJson(
  area: string,
  flow: string,
  path: string,
  assert: (
    json: any,
    status: number,
    raw: string,
  ) => { result: Status; notes: string },
): Promise<any> {
  const res = await get(path);
  if (res.status === 0) {
    record(area, flow, "WARN", res.ms, `network: ${res.raw.slice(0, 120)}`);
    return null;
  }
  if (!res.ok || res.json?.success === false) {
    const errMsg = String(res.json?.error ?? res.raw).slice(0, 160);
    if (isTransient(res.status, res.raw + errMsg)) {
      record(area, flow, "SKIP", res.ms, `upstream ${res.status}: ${errMsg}`);
      return null;
    }
    const judged = assert(res.json, res.status, res.raw);
    if (judged.result === "PASS") {
      // assertion may accept non-2xx in rare cases
      record(area, flow, judged.result, res.ms, judged.notes);
      return res.json;
    }
    record(area, flow, "FAIL", res.ms, `HTTP ${res.status}: ${errMsg}`);
    return null;
  }
  const judged = assert(res.json, res.status, res.raw);
  record(area, flow, judged.result, res.ms, judged.notes);
  return judged.result === "FAIL" ? null : res.json;
}

function expectSuccessArray(min = 1) {
  return (json: any) => {
    const n = arrayLen(json?.data ?? json);
    if (json?.success === false)
      return { result: "FAIL" as const, notes: String(json.error) };
    if (n >= min) return { result: "PASS" as const, notes: `${n} items` };
    return {
      result: "FAIL" as const,
      notes: `expected >=${min} items, got ${n}`,
    };
  };
}

function expectOk() {
  return (json: any) => {
    if (json?.success) return { result: "PASS" as const, notes: "ok" };
    return {
      result: "FAIL" as const,
      notes: String(json?.error ?? "no success"),
    };
  };
}

async function main() {
  console.log(`\nYomi Core E2E smoke → ${BASE}\n`);

  // ── Health / infra ──────────────────────────────────────────────
  await checkJson("Health", "GET /health", "/health", (json) => {
    if (json?.data?.status === "ok")
      return { result: "PASS", notes: `v${json.data.version ?? "?"}` };
    return { result: "FAIL", notes: "missing status ok" };
  });

  {
    const res = await get("/playground");
    if (res.status === 200 && /playground|yomi|html/i.test(res.raw)) {
      record("Health", "GET /playground", "PASS", res.ms, "html loaded");
    } else if (res.status === 0) {
      record("Health", "GET /playground", "WARN", res.ms, res.raw.slice(0, 80));
    } else {
      record("Health", "GET /playground", "FAIL", res.ms, `HTTP ${res.status}`);
    }
  }

  await checkJson("Health", "GET /openapi.json", "/openapi.json", (json) => {
    if (json?.openapi || json?.success)
      return { result: "PASS", notes: "spec ok" };
    return { result: "FAIL", notes: "missing openapi field" };
  });
  await checkJson("Health", "GET /v1/providers", "/v1/providers", (json) => {
    if (json?.success && Array.isArray(json?.data?.anime)) {
      return { result: "PASS", notes: "capabilities listed" };
    }
    return { result: "FAIL", notes: "missing provider catalog" };
  });
  await checkJson(
    "Health",
    "GET /v1/anime/providers",
    "/v1/anime/providers",
    expectSuccessArray(1),
  );

  await checkJson(
    "Anime",
    `schedule (${TODAY})`,
    `/v1/anime/schedule?date=${TODAY}`,
    (json) => {
      if (json?.success && Array.isArray(json?.data)) {
        return { result: "PASS", notes: `${json.data.length} airings` };
      }
      return { result: "FAIL", notes: String(json?.error ?? "no schedule") };
    },
  );
  await checkJson(
    "Health",
    "GET /v1/manga/providers",
    "/v1/manga/providers",
    expectSuccessArray(1),
  );
  await checkJson(
    "Health",
    "GET /v1/hentai/sites",
    "/v1/hentai/sites",
    expectSuccessArray(1),
  );

  {
    const img =
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20-dE6UHbFFg1A5.jpg";
    const res = await get(`/v1/proxy/image?url=${encodeURIComponent(img)}`, {
      timeoutMs: 20_000,
    });
    if (res.status === 200 && res.raw.length > 100) {
      record(
        "Health",
        "GET /v1/proxy/image",
        "PASS",
        res.ms,
        `bytes=${res.raw.length}`,
      );
    } else if (isTransient(res.status, res.raw)) {
      record(
        "Health",
        "GET /v1/proxy/image",
        "SKIP",
        res.ms,
        `upstream ${res.status}`,
      );
    } else {
      record(
        "Health",
        "GET /v1/proxy/image",
        "FAIL",
        res.ms,
        `HTTP ${res.status} len=${res.raw.length}`,
      );
    }
  }

  {
    const res = await get("/v1/proxy/hls");
    if (res.status === 422) {
      record(
        "Health",
        "GET /v1/proxy/hls (validation)",
        "PASS",
        res.ms,
        "requires url",
      );
    } else {
      record(
        "Health",
        "GET /v1/proxy/hls (validation)",
        "FAIL",
        res.ms,
        `expected 422 got ${res.status}`,
      );
    }
  }

  // ── Universal search ────────────────────────────────────────────
  await checkJson(
    "Universal",
    "GET /v1/search with adult opt-in",
    "/v1/search?q=naruto&types=anime,manga,hentai",
    (json) => {
      const a = json?.data?.anime?.length ?? 0;
      const m = json?.data?.manga?.length ?? 0;
      const h = json?.data?.hentai?.length ?? 0;
      if (a + m + h > 0)
        return { result: "PASS", notes: `anime=${a} manga=${m} hentai=${h}` };
      return { result: "WARN", notes: "all buckets empty (upstream?)" };
    },
  );

  await checkJson(
    "Final API",
    "AniList-only search",
    "/v1/search/anime?q=naruto&perPage=3",
    expectSuccessArray(1),
  );
  await checkJson(
    "Final API",
    "three-source manga search",
    "/v1/search/manga?q=one%20piece",
    expectSuccessArray(1),
  );
  await checkJson(
    "Final API",
    "doujinshi search",
    "/v1/search/doujinshi?q=naruto",
    expectSuccessArray(1),
  );
  await checkJson(
    "Final API",
    "all-imageboard search",
    "/v1/search/imageboards?q=1girl&rating=safe&limit=1",
    expectSuccessArray(1),
  );
  await checkJson(
    "Final API",
    "AnimeThemes search with media",
    "/v1/search/themes?q=naruto&limit=1",
    expectSuccessArray(1),
  );
  await checkJson(
    "Final API",
    "anime episode waterfall",
    "/v1/anime/watch?title=naruto&episode=1&category=sub",
    (json) =>
      json?.data?.provider && json?.data?.sources
        ? {
            result: "PASS",
            notes: `provider=${json.data.provider}`,
          }
        : { result: "FAIL", notes: "no resolved anime source" },
  );
  await checkJson(
    "Final API",
    "manga chapter waterfall",
    "/v1/manga/read?title=one%20piece&chapter=1",
    (json) => {
      const pages = pageImageCount(json?.data?.pages);
      return json?.data?.provider && pages > 0
        ? {
            result: "PASS",
            notes: `provider=${json.data.provider} pages=${pages}`,
          }
        : { result: "FAIL", notes: "no resolved manga pages" };
    },
  );

  // ── Anime metadata search ───────────────────────────────────────
  for (const source of [
    "anilist",
    "jikan",
    "kitsu",
    "mal",
    "anipub",
    "animethemes",
  ] as const) {
    await checkJson(
      "Anime",
      `search source=${source}`,
      `/v1/anime/search?q=naruto&source=${source}&perPage=5`,
      (json) => {
        const n = arrayLen(json?.data);
        if (n > 0) return { result: "PASS", notes: `${n} results` };
        return { result: "FAIL", notes: "0 results" };
      },
    );
  }

  // AniPub search → episode catalog → direct stream
  {
    const search = await checkJson(
      "Anime",
      "anipub search",
      "/v1/anime/anipub/search?q=naruto",
      expectSuccessArray(1),
    );
    const animeId = search?.data?.[0]?.id;
    if (animeId) {
      const catalog = await checkJson(
        "Anime",
        `anipub episodes (${animeId})`,
        `/v1/anime/anipub/episodes/${encodeURIComponent(String(animeId))}`,
        (json) => {
          const n = arrayLen(json?.data?.episodes);
          return n > 0
            ? { result: "PASS", notes: `${n} episodes` }
            : { result: "FAIL", notes: "0 episodes" };
        },
      );
      const episode =
        catalog?.data?.episodes?.[1] ?? catalog?.data?.episodes?.[0];
      if (episode?.id) {
        const sources = await checkJson(
          "Anime",
          "anipub sources/stream",
          `/v1/anime/anipub/sources?episodeId=${encodeURIComponent(String(episode.id))}`,
          (json) => {
            const hls = directHlsUrls(json?.data);
            if (hls.length > 0)
              return { result: "PASS", notes: `${hls.length} direct HLS URLs` };
            if (json?.data?.streams?.[0]?.format === "embed")
              return { result: "WARN", notes: "embed only" };
            return { result: "FAIL", notes: "no stream" };
          },
        );
        const stream = sources?.data?.streams?.find(
          (item: any) => directHlsUrls(item).length > 0,
        );
        const hlsUrl = directHlsUrls(stream)[0];
        if (hlsUrl) {
          const manifest = await getExternal(hlsUrl, stream?.headers ?? {});
          const valid =
            manifest.status === 200 && manifest.text.startsWith("#EXTM3U");
          record(
            "Anime",
            "anipub HLS manifest",
            valid ? "PASS" : "FAIL",
            manifest.ms,
            valid
              ? `${manifest.contentType}, ${manifest.bytes.length} bytes`
              : `HTTP ${manifest.status}`,
          );
        }
      }
    }
  }

  // AnimeThemes official OP/ED enrichment
  {
    const media = await checkJson(
      "Anime",
      "animethemes themes (naruto)",
      "/v1/anime/animethemes/themes/naruto",
      (json) => {
        const n = arrayLen(json?.data?.themes);
        return n > 0
          ? { result: "PASS", notes: `${n} theme videos` }
          : { result: "FAIL", notes: "0 theme videos" };
      },
    );
    const videoUrl = media?.data?.themes?.[0]?.video?.url;
    if (typeof videoUrl === "string") {
      const video = await getExternal(videoUrl, { Range: "bytes=0-1023" });
      const valid =
        (video.status === 200 || video.status === 206) &&
        video.contentType.startsWith("video/") &&
        video.bytes.length > 0;
      record(
        "Anime",
        "animethemes video bytes",
        valid ? "PASS" : "FAIL",
        video.ms,
        valid
          ? `${video.contentType}, ${video.bytes.length} bytes`
          : `HTTP ${video.status}, ${video.contentType}`,
      );
    }
  }

  // AniKoto browse
  const anikotoSearch = await checkJson(
    "Anime",
    "anikoto search",
    "/v1/anime/anikoto/search?q=naruto",
    expectSuccessArray(1),
  );
  await checkJson(
    "Anime",
    "anikoto trending",
    "/v1/anime/anikoto/trending",
    expectSuccessArray(1),
  );
  await checkJson(
    "Anime",
    "anikoto popular",
    "/v1/anime/anikoto/popular?page=1",
    expectSuccessArray(1),
  );
  await checkJson(
    "Anime",
    "anikoto schedule",
    `/v1/anime/anikoto/schedule?date=${TODAY}`,
    (json) => {
      if (json?.success)
        return { result: "PASS", notes: `${arrayLen(json.data)} items` };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );

  // AniKoto episodes → sources
  {
    const slug =
      anikotoSearch?.data?.[0]?.slug ??
      anikotoSearch?.data?.[0]?.id ??
      anikotoSearch?.data?.[0]?.animeId;
    if (slug) {
      const eps = await checkJson(
        "Anime",
        `anikoto episodes (${slug})`,
        `/v1/anime/anikoto/episodes/${encodeURIComponent(String(slug))}`,
        (json) => {
          const list = json?.data?.episodes ?? json?.data ?? [];
          const n = Array.isArray(list) ? list.length : 0;
          if (n > 0) return { result: "PASS", notes: `${n} episodes` };
          return { result: "WARN", notes: "0 episodes" };
        },
      );
      const ep0 = eps?.data?.episodes?.[0] ?? eps?.data?.[0];
      const serverIds = ep0?.server_ids ?? ep0?.serverIds;
      if (serverIds) {
        const sources = await checkJson(
          "Anime",
          "anikoto sources/stream",
          `/v1/anime/anikoto/sources?serverIds=${encodeURIComponent(String(serverIds))}`,
          (json) => {
            const streams = directHlsUrls(json?.data);
            const n = arrayLen(json?.data?.streams ?? json?.data);
            if (streams.length > 0)
              return {
                result: "PASS",
                notes: `${streams.length} direct HLS URLs (n=${n})`,
              };
            if (n > 0)
              return {
                result: "WARN",
                notes: `servers/streams=${n} but no clear URL`,
              };
            return { result: "FAIL", notes: "no streams" };
          },
        );
        const hlsStream = sources?.data?.streams?.find(
          (stream: any) => directHlsUrls(stream).length > 0,
        );
        const hlsUrl = directHlsUrls(hlsStream)[0];
        if (hlsUrl) {
          try {
            const manifest = await getExternal(hlsUrl, hlsStream.headers ?? {});
            const valid =
              manifest.status === 200 && manifest.text.startsWith("#EXTM3U");
            record(
              "Anime",
              "anikoto HLS manifest",
              valid ? "PASS" : "FAIL",
              manifest.ms,
              valid
                ? `${manifest.contentType || "HLS"}, ${manifest.bytes.length} bytes`
                : `HTTP ${manifest.status}, invalid manifest`,
            );
          } catch (error) {
            record(
              "Anime",
              "anikoto HLS manifest",
              "FAIL",
              0,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } else {
        record(
          "Anime",
          "anikoto sources/stream",
          "SKIP",
          0,
          "no server_ids on first episode",
        );
      }
    } else {
      record(
        "Anime",
        "anikoto episodes→sources",
        "SKIP",
        0,
        "no search hit for chaining",
      );
    }
  }

  // Miruro: info + episodes + sources (Naruto anilist id=20)
  const ANILIST_NARUTO = 20;
  const miruroEps = await checkJson(
    "Anime",
    `miruro episodes (anilist=${ANILIST_NARUTO})`,
    `/v1/anime/miruro/episodes/${ANILIST_NARUTO}`,
    (json) => {
      if (!json?.success) return { result: "FAIL", notes: String(json?.error) };
      const providers = json?.data?.providers ?? json?.data;
      const keys =
        providers && typeof providers === "object"
          ? Object.keys(providers)
          : [];
      if (keys.length > 0)
        return {
          result: "PASS",
          notes: `providers=${keys.slice(0, 5).join(",")}`,
        };
      // some shapes nest differently
      if (arrayLen(json?.data) > 0)
        return { result: "PASS", notes: `${arrayLen(json.data)} items` };
      return { result: "WARN", notes: "empty providers" };
    },
  );

  await checkJson(
    "Anime",
    `miruro info (${ANILIST_NARUTO})`,
    `/v1/anime/miruro/info/${ANILIST_NARUTO}`,
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      return { result: "FAIL", notes: String(json?.error ?? "no data") };
    },
  );

  // Try to extract first episode id from miruro response for stream fetch
  {
    let episodeId: string | undefined;
    let streamProvider = "gogo";
    const providers = miruroEps?.data?.providers as
      | Record<string, any>
      | undefined;
    if (providers) {
      for (const [pname, pdata] of Object.entries(providers)) {
        const cats = pdata?.episodes ?? {};
        for (const cat of ["sub", "dub", "raw"]) {
          const list = cats[cat];
          if (Array.isArray(list) && list.length > 0 && list[0]?.id) {
            episodeId = String(list[0].id);
            streamProvider = pname;
            break;
          }
        }
        if (episodeId) break;
      }
    }
    if (episodeId) {
      await checkJson(
        "Anime",
        `miruro sources (${streamProvider})`,
        `/v1/anime/${encodeURIComponent(streamProvider)}/sources?episodeId=${encodeURIComponent(episodeId)}&anilistId=${ANILIST_NARUTO}&category=sub`,
        (json) => {
          const streams = directHlsUrls(json?.data);
          if (streams.length > 0)
            return { result: "PASS", notes: "stream/m3u8 URL present" };
          if (json?.success && json?.data) {
            return {
              result: "WARN",
              notes: "payload ok but no clear stream URL",
            };
          }
          return { result: "FAIL", notes: String(json?.error ?? "no data") };
        },
      );
    } else {
      record(
        "Anime",
        "miruro sources",
        "SKIP",
        0,
        "no episode id from miruro episodes",
      );
    }
  }

  // ── Manga search providers ──────────────────────────────────────
  const mangaProviders = ["weebcentral", "mangafire", "omegascans"] as const;
  const mangaHits: Record<string, { id: string; title?: string } | null> = {};
  const mangaQuery: Record<string, string> = {
    weebcentral: "solo",
    mangafire: "one piece",
    omegascans: "moby dick",
  };

  for (const provider of mangaProviders) {
    const q = mangaQuery[provider] ?? "solo";
    const json = await checkJson(
      "Manga",
      `search provider=${provider}`,
      `/v1/manga/search?q=${encodeURIComponent(q)}&provider=${provider}&page=1`,
      (json) => {
        const n = arrayLen(json?.data);
        if (n > 0) return { result: "PASS", notes: `${n} results` };
        return { result: "WARN", notes: "0 results" };
      },
    );
    const first = json?.data?.[0];
    mangaHits[provider] = first?.id
      ? { id: String(first.id), title: first.title }
      : null;
  }

  // Series → chapters → pages for providers that returned hits
  for (const provider of ["weebcentral", "mangafire", "omegascans"] as const) {
    const hit = mangaHits[provider];
    if (!hit) {
      record("Manga", `${provider} series→pages`, "SKIP", 0, "no search hit");
      continue;
    }
    const seriesPath = `/v1/manga/${provider}/series/${encodeURIComponent(hit.id)}?include=chapters`;
    const series = await checkJson(
      "Manga",
      `${provider} series+chapters`,
      seriesPath,
      (json) => {
        const chapters = json?.data?.chapters ?? [];
        const n = Array.isArray(chapters) ? chapters.length : 0;
        if (json?.success && json?.data) {
          return { result: "PASS", notes: `title ok, chapters=${n}` };
        }
        return { result: "FAIL", notes: String(json?.error ?? "no series") };
      },
    );

    const chapters: any[] = series?.data?.chapters ?? [];
    const ch = chapters[0];
    if (!ch) {
      record("Manga", `${provider} pages`, "SKIP", 0, "no chapters on series");
      continue;
    }

    const chapterId = String(
      provider === "omegascans"
        ? (ch.slug ?? ch.id ?? "")
        : (ch.id ?? ch.slug ?? ""),
    );
    let pagesPath: string;
    if (provider === "weebcentral") {
      pagesPath = `/v1/manga/${provider}/pages/${encodeURIComponent(chapterId)}`;
    } else {
      pagesPath = `/v1/manga/${provider}/pages/${encodeURIComponent(hit.id)}/${encodeURIComponent(chapterId)}`;
    }

    const pages = await checkJson(
      "Manga",
      `${provider} pages`,
      pagesPath,
      (json) => {
        const n = pageImageCount(json?.data);
        if (n > 0) return { result: "PASS", notes: `${n} page image URLs` };
        if (json?.success)
          return { result: "WARN", notes: "success but 0 page URLs" };
        return { result: "FAIL", notes: String(json?.error ?? "no pages") };
      },
    );
    const imageUrl = pages?.data?.images?.[0];
    if (typeof imageUrl === "string") {
      try {
        const headers =
          pages.data.headerForImage ?? pages.data.imageHeaders ?? {};
        const image = await getExternal(imageUrl, headers);
        const valid =
          image.status === 200 &&
          image.contentType.startsWith("image/") &&
          image.bytes.length > 1000;
        record(
          "Manga",
          `${provider} first page image`,
          valid ? "PASS" : "FAIL",
          image.ms,
          valid
            ? `${image.contentType}, ${image.bytes.length} bytes`
            : `HTTP ${image.status}, ${image.contentType || "unknown type"}`,
        );
      } catch (error) {
        record(
          "Manga",
          `${provider} first page image`,
          "FAIL",
          0,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // WeebCentral slash ID regression
  {
    const id = "01J76XYCPSY3C4BNPBRY8JMCBE/Solo-Leveling";
    const res = await get(
      `/v1/manga/weebcentral/series/${encodeURIComponent(id)}`,
    );
    if (res.status === 404) {
      record(
        "Manga",
        "weebcentral slash id routing",
        "FAIL",
        res.ms,
        "404 — route not matching",
      );
    } else if (res.ok && res.json?.success) {
      record(
        "Manga",
        "weebcentral slash id routing",
        "PASS",
        res.ms,
        "routed + series ok",
      );
    } else if (isTransient(res.status, res.raw)) {
      record(
        "Manga",
        "weebcentral slash id routing",
        "PASS",
        res.ms,
        `routed (upstream ${res.status})`,
      );
    } else if (res.status !== 404) {
      record(
        "Manga",
        "weebcentral slash id routing",
        "PASS",
        res.ms,
        `routed HTTP ${res.status}`,
      );
    } else {
      record(
        "Manga",
        "weebcentral slash id routing",
        "FAIL",
        res.ms,
        `HTTP ${res.status}`,
      );
    }
  }

  // ── Hentai ──────────────────────────────────────────────────────
  await checkJson(
    "Hentai",
    "GET /v1/hentai/search?q=1girl&site=danbooru",
    "/v1/hentai/search?q=1girl&site=danbooru&limit=5",
    (json) => {
      const n = json?.data?.posts?.length ?? arrayLen(json?.data);
      if (n > 0) return { result: "PASS", notes: `${n} posts` };
      return { result: "WARN", notes: "0 posts" };
    },
  );
  await checkJson(
    "Hentai",
    "GET /v1/hentai/danbooru/posts",
    "/v1/hentai/danbooru/posts?tags=1girl&limit=5",
    (json) => {
      const n = json?.data?.posts?.length ?? arrayLen(json?.data);
      if (n > 0) return { result: "PASS", notes: `${n} posts` };
      return { result: "WARN", notes: "0 posts" };
    },
  );
  {
    const res = await get("/v1/hentai/videos/test");
    if (res.status === 501) {
      record(
        "Hentai",
        "videos 501 stub",
        "SKIP",
        res.ms,
        "not implemented as expected",
      );
    } else {
      record(
        "Hentai",
        "videos 501 stub",
        "WARN",
        res.ms,
        `expected 501 got ${res.status}`,
      );
    }
  }

  // ── Metadata ────────────────────────────────────────────────────
  await checkJson(
    "Metadata",
    "jikan top",
    "/v1/anime/jikan/top?page=1&limit=5",
    expectSuccessArray(1),
  );
  await checkJson(
    "Metadata",
    "jikan season",
    "/v1/anime/jikan/season?page=1&limit=5",
    expectSuccessArray(1),
  );
  await checkJson(
    "Metadata",
    "jikan anime :malId",
    "/v1/anime/jikan/20",
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );
  await checkJson(
    "Metadata",
    "kitsu anime :id",
    "/v1/anime/kitsu/1555",
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );
  await checkJson(
    "Metadata",
    "mal anime :malId",
    "/v1/anime/mal/20",
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      if (
        String(json?.error ?? "")
          .toLowerCase()
          .includes("client")
      ) {
        return { result: "SKIP", notes: "MAL_CLIENT_ID missing?" };
      }
      return { result: "FAIL", notes: String(json?.error) };
    },
  );
  await checkJson(
    "Metadata",
    "anilist relations",
    "/v1/anime/metadata/20/relations",
    (json) => {
      if (json?.success)
        return { result: "PASS", notes: `${arrayLen(json.data)} relations` };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );
  await checkJson(
    "Metadata",
    "jikan manga search",
    "/v1/manga/jikan/search?q=berserk",
    expectSuccessArray(1),
  );
  await checkJson(
    "Metadata",
    "jikan manga :malId",
    "/v1/manga/jikan/2",
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );
  await checkJson(
    "Metadata",
    "kitsu manga search",
    "/v1/manga/kitsu/search?q=berserk",
    expectSuccessArray(1),
  );
  await checkJson(
    "Metadata",
    "kitsu manga :id",
    "/v1/manga/kitsu/8",
    (json) => {
      if (json?.success && json?.data)
        return { result: "PASS", notes: "info ok" };
      return { result: "FAIL", notes: String(json?.error) };
    },
  );

  // ── Summary ─────────────────────────────────────────────────────
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, WARN: 0 };
  for (const r of rows) counts[r.result]++;

  console.log("\n=== RESULTS TABLE ===\n");
  console.log("| Area | Endpoint / flow | Result | ms | Notes |");
  console.log("|------|-----------------|--------|----|-------|");
  for (const r of rows) {
    const notes = r.notes.replace(/\|/g, "/").slice(0, 100);
    console.log(`| ${r.area} | ${r.flow} | ${r.result} | ${r.ms} | ${notes} |`);
  }
  console.log(
    `\nTotals: PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP} WARN=${counts.WARN} (${rows.length} checks)`,
  );

  const streamRow = rows.find(
    (r) => /sources|stream/i.test(r.flow) && r.result === "PASS",
  );
  const pagesRow = rows.find(
    (r) => /pages/i.test(r.flow) && r.result === "PASS",
  );
  console.log(
    `Streams confirmed: ${streamRow ? `YES — ${streamRow.flow}` : "NO"}`,
  );
  console.log(
    `Manga pages confirmed: ${pagesRow ? `YES — ${pagesRow.flow}` : "NO"}`,
  );

  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
