import {
  ProviderError,
  TTL,
  anilistQuery,
  cached,
  getJikanManga,
  getKitsuManga,
  searchJikanManga,
  searchKitsuManga,
} from "../../shared/src";
import { atsumaruProvider } from "./providers/atsumaru/index.js";
import { mangaballProvider } from "./providers/mangaball/index.js";
import { mangafireProvider } from "./providers/mangafire/index.js";
import { mangakProvider } from "./providers/mangak/index.js";
import { mangakatanaProvider } from "./providers/mangakatana/index.js";
import { omegascansProvider } from "./providers/omegascans/index.js";
import { weebcentralProvider } from "./providers/weebcentral/index.js";
import type {
  MangaSearchPage,
  MangaSearchResult,
  MangaSourceId,
} from "./types.js";

export type MangaProviderId = MangaSourceId;

export const MANGA_SOURCE_CODENAMES = {
  mangak: "jett",
  omegascans: "sage",
  mangafire: "phoenix",
  weebcentral: "sova",
  atsumaru: "viper",
  mangakatana: "reyna",
  mangaball: "cypher",
} as const satisfies Record<MangaProviderId, string>;

export type MangaSourceCodename =
  (typeof MANGA_SOURCE_CODENAMES)[MangaProviderId];

export function resolveMangaProviderId(value: string): MangaProviderId | null {
  const normalized = value.toLowerCase();
  if (normalized in providers) return normalized as MangaProviderId;
  return (
    (Object.entries(MANGA_SOURCE_CODENAMES).find(
      ([, codename]) => codename === normalized,
    )?.[0] as MangaProviderId | undefined) ?? null
  );
}

const providers = {
  mangak: mangakProvider,
  omegascans: omegascansProvider,
  mangafire: mangafireProvider,
  weebcentral: weebcentralProvider,
  atsumaru: atsumaruProvider,
  mangakatana: mangakatanaProvider,
  mangaball: mangaballProvider,
} as const;

const MANGA_PRIORITY: MangaProviderId[] = [
  "mangak",
  "mangafire",
  "weebcentral",
  "omegascans",
  "atsumaru",
  "mangakatana",
  "mangaball",
];

const MANGA_SEARCH_PRIORITY: MangaProviderId[] = [...MANGA_PRIORITY];

function normalizedTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getMangaProvider(id: MangaProviderId) {
  const p = providers[id];
  if (!p) throw new Error(`Unknown manga provider: ${id}`);
  return p;
}

export async function mangaSearch(
  query: string,
  page = 1,
  provider?: MangaProviderId,
): Promise<MangaSearchPage> {
  if (provider) {
    return cached(
      `manga_search_${provider}_${query}_${page}`,
      TTL.manga,
      async () => {
        const result = await providers[provider].search(query, page);

        const pagination =
          "pagination" in result ? result.pagination : undefined;
        const hasNextPage =
          "hasNextPage" in result ? result.hasNextPage : false;
        return {
          results: result.results.map((item) => ({
            ...item,
            provider,
            codename: MANGA_SOURCE_CODENAMES[provider],
            sourceIds: { [provider]: item.id },
            sources: [
              {
                provider,
                codename: MANGA_SOURCE_CODENAMES[provider],
                id: item.id,
                title: item.title,
                image: item.image,
              },
            ],
          })) as MangaSearchResult[],
          pagination: {
            page: pagination?.page ?? page,
            perPage: pagination?.perPage ?? 20,
            total: pagination?.total ?? result.results.length,
            hasNextPage: pagination?.hasNextPage ?? hasNextPage ?? false,
          },
        };
      },
    );
  }

  const settled = await Promise.allSettled(
    MANGA_SEARCH_PRIORITY.map((id) => providers[id].search(query, page)),
  );
  const grouped = new Map<string, MangaSearchResult>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const provider = MANGA_SEARCH_PRIORITY[index];
    if (!provider) return;
    for (const item of result.value.results) {
      const key = normalizedTitle(item.title) || `${provider}:${item.id}`;
      const existing = grouped.get(key);
      const source = {
        provider,
        codename: MANGA_SOURCE_CODENAMES[provider],
        id: item.id,
        title: item.title,
        image: item.image,
      };
      if (!existing) {
        grouped.set(key, {
          ...item,
          provider,
          codename: MANGA_SOURCE_CODENAMES[provider],
          sourceIds: { [provider]: item.id },
          sources: [source],
        });
        continue;
      }
      existing.sourceIds = { ...existing.sourceIds, [provider]: item.id };
      existing.sources = [...(existing.sources ?? []), source];
    }
  });
  const results = [...grouped.values()];

  return {
    results,
    pagination: {
      page,
      perPage: 20,
      total: results.length,
      hasNextPage: settled.some(
        (result) =>
          result.status === "fulfilled" &&
          ("pagination" in result.value
            ? Boolean(result.value.pagination?.hasNextPage)
            : Boolean(result.value.hasNextPage)),
      ),
    },
    sources: settled.map((result, index) => ({
      provider: MANGA_SEARCH_PRIORITY[index] as MangaProviderId,
      status: result.status,
      count: result.status === "fulfilled" ? result.value.results.length : 0,
      ...(result.status === "rejected"
        ? { error: errorMessage(result.reason) }
        : {}),
    })),
  };
}

function chapterNumber(value: string): number | null {
  const match = value.match(/(?:chapter|ch\.?|^)[\s_-]*(\d+(?:\.\d+)?)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function findChapter(
  chapters: import("./types.js").Chapter[],
  requested: string,
) {
  const normalized = requested.trim().toLowerCase();
  const requestedNumber = chapterNumber(normalized);
  return chapters.find((chapter) =>
    [chapter.id, chapter.slug, chapter.index, chapter.name].some((value) => {
      const text = String(value).trim().toLowerCase();
      if (text === normalized) return true;
      const number = chapterNumber(text);
      return requestedNumber !== null && number === requestedNumber;
    }),
  );
}

export async function resolveMangaChapter(
  title: string,
  chapter: string,
  source?: MangaProviderId,
) {
  const attempts: Array<Record<string, unknown>> = [];
  for (const provider of source ? [source] : MANGA_PRIORITY) {
    try {
      const search = await mangaSearch(title, 1, provider);
      const target = [...search.results].sort((left, right) => {
        const query = normalizedTitle(title);
        const rank = (item: MangaSearchResult) => {
          const value = normalizedTitle(item.title);
          return value === query ? 0 : value.startsWith(query) ? 1 : 2;
        };
        return rank(left) - rank(right);
      })[0];
      if (!target) throw new ProviderError("No matching series", 404);
      const series = await mangaSeries(provider, target.id, true);
      const targetChapter = findChapter(series.chapters, chapter);
      if (!targetChapter)
        throw new ProviderError(`Chapter ${chapter} not found`, 404);
      const pages = await mangaPages(
        provider,
        target.id,
        String(targetChapter.slug || targetChapter.id),
      );
      if (!pages.images.length)
        throw new ProviderError("Chapter returned no pages", 502);
      attempts.push({ provider, status: "fulfilled" });
      return {
        title: series.title || target.title,
        requestedChapter: chapter,
        provider,
        codename: MANGA_SOURCE_CODENAMES[provider],
        sourceId: target.id,
        chapter: targetChapter,
        pages,
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider,
        status: "rejected",
        error: errorMessage(error),
      });
    }
  }
  throw new ProviderError(
    `No manga source could load chapter ${chapter}. ${attempts
      .map((attempt) => `${attempt.provider}: ${attempt.error}`)
      .join("; ")}`,
    502,
  );
}

export async function aggregateMangaSeries(
  title: string,
  source?: MangaProviderId,
) {
  const search = await mangaSearch(title, 1, source);
  const exact = normalizedTitle(title);
  const match =
    search.results.find((item) => normalizedTitle(item.title) === exact) ??
    search.results[0];
  if (!match) throw new ProviderError("Manga not found", 404);
  const candidates = source
    ? [
        {
          provider: source,
          id: match.id,
          title: match.title,
          image: match.image,
        },
      ]
    : (match.sources ?? [
        {
          provider: match.provider as MangaProviderId,
          id: match.id,
          title: match.title,
          image: match.image,
        },
      ]);
  const settled = await Promise.allSettled(
    candidates.map(({ provider, id }) => mangaSeries(provider, id, true)),
  );
  const successful = settled.flatMap((result, index) =>
    result.status === "fulfilled"
      ? [
          {
            series: result.value,
            source: candidates[index] as (typeof candidates)[number],
          },
        ]
      : [],
  );
  if (!successful.length)
    throw new ProviderError("No source returned manga details", 502);
  const chapters = new Map<string, import("./types.js").Chapter>();
  for (const { series, source: candidate } of successful) {
    for (const chapter of series.chapters) {
      const number = chapterNumber(
        chapter.index || chapter.name || String(chapter.id),
      );
      const key =
        number === null ? normalizedTitle(chapter.name) : String(number);
      const sourceEntry = {
        provider: candidate.provider,
        codename: MANGA_SOURCE_CODENAMES[candidate.provider],
        seriesId: candidate.id,
        chapterSlug: String(chapter.slug || chapter.id),
      };
      const existing = chapters.get(key);
      if (existing) {
        existing.sources = [...(existing.sources ?? []), sourceEntry];
      } else {
        chapters.set(key, { ...chapter, slug: key, sources: [sourceEntry] });
      }
    }
  }
  const primary = successful[0] as (typeof successful)[number];
  return {
    ...primary.series,
    provider: "aggregate",
    codename: "chamber",
    chapters: [...chapters.values()].sort(
      (left, right) => Number(right.index) - Number(left.index),
    ),
    sources: successful.map(({ source: candidate }) => ({
      ...candidate,
      codename: MANGA_SOURCE_CODENAMES[candidate.provider],
    })),
    sourceStatus: settled.map((result, index) => ({
      provider: candidates[index]?.provider,
      status: result.status,
      ...(result.status === "rejected"
        ? { error: errorMessage(result.reason) }
        : {}),
    })),
  };
}

export async function aggregateMangaPages(
  title: string,
  chapter: string,
  source?: MangaProviderId,
) {
  return resolveMangaChapter(title, chapter, source);
}

function recommendationReason(
  title: string,
  queries: string[],
  sourceCount: number,
): string {
  const matched = queries.find((query) =>
    normalizedTitle(title).includes(normalizedTitle(query)),
  );
  return matched
    ? `Matches ${matched}`
    : `Available from ${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
}

export async function recommendManga(input: {
  titles?: string[];
  genres?: string[];
  history?: string[];
  limit?: number;
}) {
  const queries = [...(input.genres ?? []), ...(input.titles ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!queries.length)
    throw new ProviderError("At least one title or genre is required", 422);
  const excluded = new Set(
    [...(input.history ?? []), ...(input.titles ?? [])].map(normalizedTitle),
  );
  const settled = await Promise.allSettled(
    queries.map((query) => mangaSearch(query, 1)),
  );
  const ranked = new Map<
    string,
    MangaSearchResult & { score: number; reason: string }
  >();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.results) {
      const key = normalizedTitle(item.title);
      if (!key || excluded.has(key)) continue;
      const sourceCount = item.sources?.length ?? 1;
      const score =
        sourceCount * 10 +
        queries.filter((query) => key.includes(normalizedTitle(query))).length *
          5;
      const existing = ranked.get(key);
      if (!existing || score > existing.score)
        ranked.set(key, {
          ...item,
          score,
          reason: recommendationReason(item.title, queries, sourceCount),
        });
    }
  }
  return [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));
}

export async function mangaHome() {
  return cached("manga_home_v1", TTL.manga, async () => {
    const fields =
      "id title { english romaji } coverImage { extraLarge large } genres averageScore popularity updatedAt";
    const data = await anilistQuery(`query {
      trending: Page(page: 1, perPage: 12) { media(type: MANGA, isAdult: false, sort: TRENDING_DESC) { ${fields} } }
      popular: Page(page: 1, perPage: 12) { media(type: MANGA, isAdult: false, sort: POPULARITY_DESC) { ${fields} } }
      recent: Page(page: 1, perPage: 12) { media(type: MANGA, isAdult: false, sort: UPDATED_AT_DESC) { ${fields} } }
    }`);
    type AniListHomeItem = {
      id: number;
      title?: { english?: string; romaji?: string };
      coverImage?: { extraLarge?: string; large?: string };
      genres?: string[];
      averageScore?: number;
      popularity?: number;
      updatedAt?: number;
    };
    const mapPage = (key: "trending" | "popular" | "recent") => {
      const page = data[key] as { media?: AniListHomeItem[] } | undefined;
      return (page?.media ?? []).map((item) => ({
        id: String(item.id),
        title: item.title?.english ?? item.title?.romaji ?? String(item.id),
        image: item.coverImage?.extraLarge ?? item.coverImage?.large ?? "",
        genres: item.genres ?? [],
        score: item.averageScore ?? null,
        popularity: item.popularity ?? null,
        updatedAt: item.updatedAt ?? null,
        provider: "anilist",
      }));
    };
    return {
      trending: mapPage("trending"),
      popular: mapPage("popular"),
      recentlyUpdated: mapPage("recent"),
    };
  });
}

export async function mangaSeries(
  provider: MangaProviderId,
  id: string,
  includeChapters = false,
) {
  const key = `manga_series_${provider}_${id}_${includeChapters}`;
  return cached(key, TTL.manga, async () => {
    return providers[provider].getSeries(id, includeChapters);
  });
}

export async function mangaPages(
  provider: MangaProviderId,
  id: string,
  chapterSlug?: string,
) {
  const key = `manga_pages_${provider}_${id}_${chapterSlug ?? ""}`;
  return cached(key, TTL.manga, async () => {
    if (provider === "omegascans" && chapterSlug)
      return omegascansProvider.getPages(id, chapterSlug);
    if (provider === "mangak" && chapterSlug)
      return mangakProvider.getPages(id, chapterSlug);
    if (provider === "mangafire" && chapterSlug)
      return mangafireProvider.getPages(id, chapterSlug);
    if (provider === "atsumaru" && chapterSlug)
      return atsumaruProvider.getPages(id, chapterSlug);
    if (provider === "mangakatana" && chapterSlug)
      return mangakatanaProvider.getPages(id, chapterSlug);
    if (provider === "mangaball" && chapterSlug)
      return mangaballProvider.getPages(id, chapterSlug);
    if (provider === "weebcentral")
      return weebcentralProvider.getPages(chapterSlug || id);
    throw new ProviderError(`${provider} pages require a chapter slug`, 422);
  });
}

export { atsumaruProvider, mangaballProvider, mangakatanaProvider };

export async function jikanMangaSearch(query: string, page = 1, limit = 20) {
  return cached(`jikan_manga_search_${query}_${page}_${limit}`, TTL.manga, () =>
    searchJikanManga(query, page, limit),
  );
}

export async function jikanMangaInfo(malId: number) {
  return cached(`jikan_manga_${malId}`, TTL.manga, () => getJikanManga(malId));
}

export async function kitsuMangaSearch(query: string, page = 1, limit = 20) {
  return cached(`kitsu_manga_search_${query}_${page}_${limit}`, TTL.manga, () =>
    searchKitsuManga(query, page, limit),
  );
}

export async function kitsuMangaInfo(id: string | number) {
  return cached(`kitsu_manga_${id}`, TTL.manga, () => getKitsuManga(id));
}

export * from "./types.js";
export {
  mangakProvider,
  omegascansProvider,
  weebcentralProvider,
  mangafireProvider,
};
