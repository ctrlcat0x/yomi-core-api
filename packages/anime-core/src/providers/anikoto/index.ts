import { ProviderError, config } from "@yomi/shared";
import * as cheerio from "cheerio";

const PRIMARY = config.anikotoBaseUrl ?? "https://anikototv.to";
const MIRRORS = [
  "https://anikoto.cz",
  "https://anikoto.me",
  "https://anikoto.net",
  "https://anikoto.se",
];

const BASE_HEADERS = {
  "User-Agent": config.userAgent,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const AJAX_HEADERS = { ...BASE_HEADERS, "X-Requested-With": "XMLHttpRequest" };

const PLAYER_HOSTS = new Set(["megaplay.buzz", "vidtube.site", "vidwish.live"]);

type PlayerTrack = {
  file: string;
  label?: string;
  kind?: string;
  default?: boolean;
};

type ResolvedPlayerSource = {
  url: string;
  embedUrl: string;
  format: "hls";
  headers: Record<string, string>;
  tracks: PlayerTrack[];
  intro: unknown;
  outro: unknown;
};

async function tryFetch(url: string, ajax = false): Promise<Response> {
  const headers = ajax ? AJAX_HEADERS : BASE_HEADERS;
  const res = await fetch(url, { headers });
  if (res.ok) return res;
  throw new ProviderError(`AniKoto HTTP ${res.status}: ${url}`);
}

async function fetchWithMirrors(path: string, ajax = false): Promise<Response> {
  const domains = [PRIMARY, ...MIRRORS];
  const errors: string[] = [];
  for (const domain of domains) {
    try {
      return await tryFetch(`${domain}${path}`, ajax);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new ProviderError(`All AniKoto mirrors failed: ${errors[0]}`);
}

async function resolveAnimeId(
  slug: string,
): Promise<{ animeId: number; base: string }> {
  const domains = [PRIMARY, ...MIRRORS];
  for (const domain of domains) {
    try {
      const res = await fetch(`${domain}/watch/${slug}`, {
        headers: BASE_HEADERS,
      });
      if (!res.ok) continue;
      const $ = cheerio.load(await res.text());
      const animeId = Number.parseInt(
        $("#watch-main").attr("data-id") ?? "0",
        10,
      );
      if (animeId) return { animeId, base: domain };
    } catch {
      // try next mirror
    }
  }
  return { animeId: 0, base: PRIMARY };
}

export async function extractEpisodeList(slugOrId: string) {
  let animeId = 0;

  if (/^\d+$/.test(slugOrId)) {
    animeId = Number.parseInt(slugOrId, 10);
  } else {
    const resolved = await resolveAnimeId(slugOrId);
    animeId = resolved.animeId;
  }

  if (!animeId) {
    return { animeId: 0, slug: slugOrId, totalEpisodes: 0, episodes: [] };
  }

  try {
    const res = await fetchWithMirrors(`/ajax/episode/list/${animeId}`, true);
    const ajaxRaw = await res.json();
    const ajaxHtml =
      typeof ajaxRaw === "string"
        ? ajaxRaw
        : ((ajaxRaw as { result?: string })?.result ?? "");
    const $ep = cheerio.load(ajaxHtml);
    const episodes: Array<Record<string, unknown>> = [];

    // Reference: episodes are in li[data-html] > a (not bare a[data-num])
    $ep("li[data-html]").each((i, li) => {
      const a = $ep(li).find("a").first();
      if (!a.length) return;

      episodes.push({
        id: a.attr("data-id") || a.attr("data-ep-id") || "",
        number: Number.parseInt(a.attr("data-num") ?? "", 10) || i + 1,
        episode_no: Number.parseInt(a.attr("data-num") ?? "", 10) || i + 1,
        slug: a.attr("data-slug") || "",
        title: $ep(li).attr("title") || a.find(".d-title").text().trim() || "",
        jp_title: a.find(".d-title").attr("data-jp") || "",
        has_sub: a.attr("data-sub") === "1",
        has_dub: a.attr("data-dub") === "1",
        // server_ids is the base64-blob passed to /ajax/server/list?servers=
        server_ids: a.attr("data-ids") || "",
        timestamp: a.attr("data-timestamp") || "",
        mal_id: a.attr("data-mal") || "",
        href: a.attr("href") || "",
        active: a.hasClass("active"),
        filler: false,
      });
    });

    // Fallback to bare anchor selector if site changes HTML structure
    if (!episodes.length) {
      $ep("a[data-num], a[data-ep-id], a[data-id]").each((i, el) => {
        episodes.push({
          id: $ep(el).attr("data-ep-id") || $ep(el).attr("data-id") || "",
          number: Number.parseInt($ep(el).attr("data-num") ?? "", 10) || i + 1,
          episode_no:
            Number.parseInt($ep(el).attr("data-num") ?? "", 10) || i + 1,
          slug: $ep(el).attr("data-slug") || "",
          title: $ep(el).find(".ep-title, .ep-name").text().trim() || "",
          server_ids: $ep(el).attr("data-ids") || "",
          timestamp: $ep(el).attr("data-timestamp") || "",
          mal_id: $ep(el).attr("data-mal") || "",
          href: $ep(el).attr("href") || "",
          active: false,
          filler: false,
        });
      });
    }

    return {
      animeId,
      slug: slugOrId,
      totalEpisodes: episodes.length,
      episodes,
    };
  } catch {
    return { animeId, slug: slugOrId, totalEpisodes: 0, episodes: [] };
  }
}

export async function extractServerList(episodeIds: string) {
  const res = await fetchWithMirrors(
    `/ajax/server/list?servers=${encodeURIComponent(episodeIds)}`,
    true,
  );
  const raw = await res.json();
  const html =
    typeof raw === "string"
      ? raw
      : ((raw as { result?: string })?.result ?? "");
  const $ = cheerio.load(html);
  const servers: Array<Record<string, unknown>> = [];

  $(".servers .type").each((_, typeEl) => {
    const type = $(typeEl).attr("data-type") || "sub";
    $(typeEl)
      .find("li[data-link-id]")
      .each((__, li) => {
        servers.push({
          type,
          ep_id: $(li).attr("data-ep-id") || "",
          link_id: $(li).attr("data-link-id") || "",
          cmid: $(li).attr("data-cmid") || "",
          sv_id: $(li).attr("data-sv-id") || "",
          name: $(li).text().trim() || "",
        });
      });
  });

  return servers;
}

export async function extractStreamInfo(linkId: string) {
  const res = await fetchWithMirrors(
    `/ajax/server?get=${encodeURIComponent(linkId)}`,
    true,
  );
  const data = await res.json();
  if (!data || !(data as { result?: unknown }).result) {
    return { linkId, url: null, skipData: null };
  }

  const raw = (data as { result: unknown }).result;
  const result =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })()
      : (raw as Record<string, unknown>);

  return {
    linkId,
    url: (result.url as string) || null,
    skipData: (result.skip_data as unknown) || null,
  };
}

function isAllowedPlayerUrl(url: URL): boolean {
  return url.protocol === "https:" && PLAYER_HOSTS.has(url.hostname);
}

export async function resolvePlayerSource(
  embedUrl: string,
): Promise<ResolvedPlayerSource | null> {
  let playerUrl: URL;
  try {
    playerUrl = new URL(embedUrl);
  } catch {
    return null;
  }

  if (!isAllowedPlayerUrl(playerUrl)) return null;

  try {
    const page = await fetch(playerUrl, {
      headers: { ...BASE_HEADERS, Referer: `${playerUrl.origin}/` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!page.ok) return null;

    const $ = cheerio.load(await page.text());
    const sourceId =
      $("#megaplay-player").attr("data-id") ??
      $("[data-id]").filter("div").first().attr("data-id") ??
      "";
    if (!/^\d+$/.test(sourceId)) return null;

    const sourceUrl = new URL("/stream/getSources", playerUrl.origin);
    sourceUrl.searchParams.set("id", sourceId);
    const sourceResponse = await fetch(sourceUrl, {
      headers: {
        ...AJAX_HEADERS,
        Accept: "application/json, text/plain, */*",
        Origin: playerUrl.origin,
        Referer: playerUrl.toString(),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!sourceResponse.ok) return null;

    const payload = (await sourceResponse.json()) as {
      sources?: { file?: string } | Array<{ file?: string }>;
      tracks?: PlayerTrack[];
      intro?: unknown;
      outro?: unknown;
    };
    const file = Array.isArray(payload.sources)
      ? payload.sources.find((source) => source.file)?.file
      : payload.sources?.file;
    if (!file) return null;

    const directUrl = new URL(file);
    if (directUrl.protocol !== "https:") return null;
    const streamHeaders = {
      "User-Agent": config.userAgent,
      Referer: `${playerUrl.origin}/`,
      Origin: playerUrl.origin,
      Accept: "application/vnd.apple.mpegurl,*/*",
    };
    const manifest = await fetch(directUrl, {
      headers: streamHeaders,
      signal: AbortSignal.timeout(12_000),
    });
    if (
      !manifest.ok ||
      !(await manifest.text()).trimStart().startsWith("#EXTM3U")
    ) {
      return null;
    }

    return {
      url: directUrl.toString(),
      embedUrl: playerUrl.toString(),
      format: "hls",
      headers: streamHeaders,
      tracks: Array.isArray(payload.tracks) ? payload.tracks : [],
      intro: payload.intro ?? null,
      outro: payload.outro ?? null,
    };
  } catch {
    return null;
  }
}

export async function extractMapperServers(
  malId: string,
  slug: string,
  timestamp: string,
) {
  if (!malId || !slug || !timestamp) return [];
  if (
    !/^\d+$/.test(malId) ||
    !/^[a-zA-Z0-9-]+$/.test(slug) ||
    !/^\d+$/.test(timestamp)
  )
    return [];

  try {
    const url = `https://mapper.nekostream.site/api/mal/${malId}/${slug}/${timestamp}`;
    const res = await fetch(url, { headers: BASE_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    const servers: Array<Record<string, unknown>> = [];

    for (const [provider, sources] of Object.entries(
      data as Record<
        string,
        Record<string, { url?: string; download?: string }>
      >,
    )) {
      if (sources?.sub)
        servers.push({
          provider,
          type: "sub",
          url: sources.sub.url ?? null,
          download: sources.sub.download ?? null,
        });
      if (sources?.dub)
        servers.push({
          provider,
          type: "dub",
          url: sources.dub.url ?? null,
          download: sources.dub.download ?? null,
        });
    }
    return servers;
  } catch {
    return [];
  }
}

export async function getAnikotoSources(serverIds: string) {
  if (!serverIds) throw new ProviderError("anikoto requires serverIds");
  const servers = await extractServerList(serverIds);

  if (!servers.length) {
    throw new ProviderError(
      "No servers found for these episode IDs — they may be expired",
    );
  }

  const embeds: Array<Record<string, unknown>> = [];
  const streams: Array<Record<string, unknown>> = [];
  // Resolve every AniKoto server, then convert supported player embeds to HLS.
  await Promise.allSettled(
    servers.map(async (server) => {
      const linkId = String(server.link_id ?? "");
      if (!linkId) return;
      const stream = await extractStreamInfo(linkId);
      if (!stream.url) return;

      const embed = {
        ...server,
        embedUrl: stream.url,
        skipData: stream.skipData,
      };
      embeds.push(embed);

      const resolved = await resolvePlayerSource(stream.url);
      if (resolved) streams.push({ ...embed, ...resolved });
    }),
  );

  return { servers, embeds, streams };
}

function parseWatchSlug(href: string): string {
  return href.split("/watch/")[1]?.replace(/\/$/, "").split("/")[0] ?? "";
}

function countPaginationPages($: cheerio.CheerioAPI): number {
  const pages: number[] = [];
  $(".pagination li a").each((_, el) => {
    const n = Number.parseInt($(el).text().trim(), 10);
    if (!Number.isNaN(n)) pages.push(n);
  });
  return pages.length > 0 ? Math.max(...pages) : 1;
}

export async function getAnikotoTrending() {
  const res = await fetchWithMirrors("/home");
  const $ = cheerio.load(await res.text());
  const results: Array<Record<string, unknown>> = [];

  $(".section-updated .item, #recent-update .item").each((_, el) => {
    const slug = parseWatchSlug(
      $(el).find("a.name.d-title").attr("href") ?? "",
    );
    if (!slug) return;
    results.push({
      slug,
      poster: $(el).find(".poster img").attr("src") || "",
      title: $(el).find("a.name.d-title").text().trim() || "",
      japaneseTitle: $(el).find("a.name.d-title").attr("data-jp") || "",
      sub:
        Number.parseInt($(el).find(".ep-status.sub span").text().trim(), 10) ||
        0,
      dub:
        Number.parseInt($(el).find(".ep-status.dub span").text().trim(), 10) ||
        0,
      total:
        Number.parseInt(
          $(el).find(".ep-status.total span").text().trim(),
          10,
        ) || 0,
      type: $(el).find(".meta .inner .right").text().trim() || "",
    });
  });

  return results;
}

export async function getAnikotoPopular(page = 1) {
  const path = page > 1 ? `/most-viewed?page=${page}` : "/most-viewed";
  const res = await fetchWithMirrors(path);
  const $ = cheerio.load(await res.text());
  const totalPages = countPaginationPages($);
  const data: Array<Record<string, unknown>> = [];

  $("#list-items > .item").each((_, el) => {
    const slug = parseWatchSlug($(el).find("a").attr("href") ?? "");
    if (!slug) return;
    data.push({
      slug,
      animeId: $(el).find(".ani.poster.tip").attr("data-tip") || "",
      poster: $(el).find(".ani.poster.tip > a > img").attr("src") || "",
      title: $(el).find(".info .b1 a.name.d-title").text().trim() || "",
      japaneseTitle:
        $(el).find(".info .b1 a.name.d-title").attr("data-jp") || "",
      sub:
        Number.parseInt($(el).find(".ep-status.sub span").text().trim(), 10) ||
        0,
      dub:
        Number.parseInt($(el).find(".ep-status.dub span").text().trim(), 10) ||
        0,
      total:
        Number.parseInt(
          $(el).find(".ep-status.total span").text().trim(),
          10,
        ) || 0,
      type:
        $(el).find(".info .meta .m-item:nth-child(2) label").text().trim() ||
        "",
      rating: $(el).find(".info .meta .m-item.rated span").text().trim() || "",
    });
  });

  return { page, totalPages, data };
}

export async function getAnikotoSchedule(date: string) {
  const res = await fetchWithMirrors(`/home?date=${encodeURIComponent(date)}`);
  const $ = cheerio.load(await res.text());
  const schedule: Array<Record<string, unknown>> = [];

  $(".schedule-item, .anime-schedule .item").each((_, el) => {
    const slug = parseWatchSlug($(el).find("a").attr("href") ?? "");
    if (!slug) return;
    schedule.push({
      slug,
      title: $(el).find(".film-name a, .name").text().trim() || "",
      time: $(el).find(".time, .schedule-time").text().trim() || "",
      episode_no:
        Number.parseInt($(el).find(".episode-no, .ep-num").text().trim(), 10) ||
        0,
    });
  });

  return schedule;
}

export async function searchAnikoto(query: string) {
  const res = await fetchWithMirrors(
    `/filter?keyword=${encodeURIComponent(query)}`,
  );
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: Array<Record<string, unknown>> = [];

  // Primary selector (current anikototv.to layout)
  $("#list-items > .item").each((_, el) => {
    const href = $(el).find("a").attr("href") ?? "";
    const slug =
      href.split("/watch/")[1]?.replace(/\/$/, "").split("/")[0] ?? "";
    const title = $(el).find(".info .b1 a.name.d-title").text().trim();
    const image =
      $(el).find(".ani.poster.tip > a > img").attr("src") ||
      $(el).find("img").attr("data-src") ||
      $(el).find("img").attr("src") ||
      "";
    if (title && slug) results.push({ title, slug, image });
  });

  // Legacy fallback selectors
  if (!results.length) {
    $(".film-list .film-item, .flw-item").each((_, el) => {
      const title = $(el).find(".film-name, .dynamic-name").text().trim();
      const href = $(el).find("a").attr("href") ?? "";
      const slug =
        href.split("/watch/")[1]?.replace(/\/$/, "").split("/")[0] ?? "";
      const image =
        $(el).find("img").attr("data-src") ||
        $(el).find("img").attr("src") ||
        "";
      if (title && slug) results.push({ title, slug, image });
    });
  }

  return results;
}

export async function getAnikotoInfo(slug: string) {
  const res = await fetchWithMirrors(`/watch/${encodeURIComponent(slug)}`);
  const $ = cheerio.load(await res.text());
  const title = $("h1[itemprop='name'].title.d-title").text().trim();
  const animeId = Number.parseInt($("#watch-main").attr("data-id") ?? "0", 10);

  if (!title && !animeId)
    throw new ProviderError(`AniKoto anime not found: ${slug}`, 404);

  const collect = (selector: string) =>
    $(selector)
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean);

  return {
    slug,
    animeId,
    title,
    japaneseTitle: $("h1[itemprop='name'].title.d-title").attr("data-jp") ?? "",
    alternativeTitles: $(".names.font-italic").text().trim(),
    poster: $("img[itemprop='image']").attr("src") ?? "",
    synopsis: $(".synopsis .content").text().trim(),
    rating:
      $("#w-rating .score .value").text().trim() ||
      $("#w-rating span[itemprop='ratingValue']").text().trim(),
    reviewCount: $("#w-rating span[itemprop='reviewCount']").text().trim(),
    type: $(".bmeta .meta:first-child > div:nth-child(1) span").text().trim(),
    premiered: $(".bmeta .meta:first-child > div:nth-child(2) span")
      .text()
      .trim(),
    aired: $(".bmeta .meta:first-child > div:nth-child(3) span").text().trim(),
    status: $(".bmeta .meta:first-child > div:nth-child(4) span a")
      .text()
      .trim(),
    malScore: $(".bmeta .meta:nth-child(2) > div:nth-child(1) span")
      .text()
      .trim(),
    duration: $(".bmeta .meta:nth-child(2) > div:nth-child(2) span")
      .text()
      .trim(),
    episodes: $(".bmeta .meta:nth-child(2) > div:nth-child(3) span")
      .text()
      .trim(),
    studios: collect(
      ".bmeta .meta:nth-child(2) > div:nth-child(4) a[itemprop='director'] span[itemprop='name']",
    ),
    producers: collect(
      ".bmeta .meta:nth-child(2) > div:nth-child(5) a[itemprop='director'] span[itemprop='name']",
    ),
    genres: collect(".bmeta .meta:first-child a[href*='/genre/']"),
  };
}

export const anikotoProvider = {
  id: "anikoto" as const,
  search: searchAnikoto,
  getInfo: getAnikotoInfo,
  getTrending: getAnikotoTrending,
  getPopular: getAnikotoPopular,
  getSchedule: getAnikotoSchedule,
  getEpisodes: extractEpisodeList,
  getSources: getAnikotoSources,
  extractStreamInfo,
  extractServerList,
  extractMapperServers,
};
