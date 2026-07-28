import {
  ProviderError,
  TTL,
  cached,
  getJikanManga,
  getKitsuManga,
  searchJikanManga,
  searchKitsuManga,
} from "@yomi/shared";
import { mangafireProvider } from "./providers/mangafire/index.js";
import { omegascansProvider } from "./providers/omegascans/index.js";
import { weebcentralProvider } from "./providers/weebcentral/index.js";
import type { MangaSearchPage, MangaSearchResult } from "./types.js";

export type MangaProviderId = "omegascans" | "mangafire" | "weebcentral";

const providers = {
  omegascans: omegascansProvider,
  mangafire: mangafireProvider,
  weebcentral: weebcentralProvider,
} as const;

const MANGA_PRIORITY: MangaProviderId[] = [
  "mangafire",
  "weebcentral",
  "omegascans",
];

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
        const result =
          provider === "omegascans"
            ? await omegascansProvider.search(query, page)
            : provider === "mangafire"
              ? await mangafireProvider.search(query, page)
              : await weebcentralProvider.search(query, page);

        const pagination =
          "pagination" in result ? result.pagination : undefined;
        const hasNextPage =
          "hasNextPage" in result ? result.hasNextPage : false;
        return {
          results: result.results as MangaSearchResult[],
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

  const settled = await Promise.allSettled([
    mangafireProvider.search(query, page),
    weebcentralProvider.search(query, page),
    omegascansProvider.search(query, page),
  ]);
  const grouped = new Map<string, MangaSearchResult>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const provider = MANGA_PRIORITY[index];
    if (!provider) return;
    for (const item of result.value.results) {
      const key = normalizedTitle(item.title) || `${provider}:${item.id}`;
      const existing = grouped.get(key);
      const source = {
        provider,
        id: item.id,
        title: item.title,
        image: item.image,
      };
      if (!existing) {
        grouped.set(key, {
          ...item,
          provider,
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
      provider: MANGA_PRIORITY[index] as MangaProviderId,
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

export async function resolveMangaChapter(title: string, chapter: string) {
  const attempts: Array<Record<string, unknown>> = [];
  for (const provider of MANGA_PRIORITY) {
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

export async function mangaSeries(
  provider: MangaProviderId,
  id: string,
  includeChapters = false,
) {
  const key = `manga_series_${provider}_${id}_${includeChapters}`;
  return cached(key, TTL.manga, async () => {
    if (provider === "omegascans")
      return omegascansProvider.getSeries(id, includeChapters);
    if (provider === "mangafire")
      return mangafireProvider.getSeries(id, includeChapters);
    return weebcentralProvider.getSeries(id, includeChapters);
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
    if (provider === "mangafire" && chapterSlug)
      return mangafireProvider.getPages(id, chapterSlug);
    if (provider === "weebcentral")
      return weebcentralProvider.getPages(chapterSlug || id);
    throw new ProviderError(`${provider} pages require a chapter slug`, 422);
  });
}

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
export { omegascansProvider, weebcentralProvider, mangafireProvider };
