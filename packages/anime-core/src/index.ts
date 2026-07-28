import {
  ProviderError,
  TTL,
  cached,
  getAnimeInfo,
  getAnimeRelations,
  getAnimeSchedule,
  getJikanAnime,
  getJikanAnimeTop,
  getJikanSeasonNow,
  getKitsuAnime,
  getMalAnime,
  searchAnime,
  searchJikanAnime,
  searchKitsuAnime,
  searchMalAnime,
} from "@yomi/shared";
import { anikotoProvider } from "./providers/anikoto/index.js";
import { animethemesProvider } from "./providers/animethemes/index.js";
import { anipubProvider } from "./providers/anipub/index.js";
import { miruroProvider } from "./providers/miruro/index.js";

export type AnimeProviderId = "miruro" | "anikoto" | "anipub" | "animethemes";
export type AnimeMetadataSource =
  | "anilist"
  | "jikan"
  | "kitsu"
  | "mal"
  | "anipub"
  | "animethemes";

const providers = {
  miruro: miruroProvider,
  anikoto: anikotoProvider,
  anipub: anipubProvider,
  animethemes: animethemesProvider,
} as const;

function normalizedTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function bestTitleMatch<T extends Record<string, unknown>>(
  results: T[],
  query: string,
): T | undefined {
  const wanted = normalizedTitle(query);
  return [...results].sort((left, right) => {
    const score = (item: T) => {
      const title = normalizedTitle(String(item.title ?? item.name ?? ""));
      return title === wanted ? 0 : title.startsWith(wanted) ? 1 : 2;
    };
    return score(left) - score(right);
  })[0];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getAnimeProvider(id: AnimeProviderId) {
  const p = providers[id];
  if (!p) throw new Error(`Unknown anime provider: ${id}`);
  return p;
}

export async function animeSearch(
  query: string,
  page = 1,
  perPage = 20,
  source: AnimeMetadataSource = "anilist",
) {
  const key = `anime_search_${source}_${query}_${page}_${perPage}`;
  return cached(key, TTL.search, async () => {
    if (source === "anipub") return anipubProvider.search(query, page, perPage);
    if (source === "animethemes")
      return animethemesProvider.search(query, page, perPage);
    if (source === "jikan") return searchJikanAnime(query, page, perPage);
    if (source === "kitsu") return searchKitsuAnime(query, page, perPage);
    if (source === "mal") {
      const data = await searchMalAnime(query, perPage, (page - 1) * perPage);
      if ("paging" in data && data.paging) {
        return {
          page: data.paging.page,
          perPage: data.paging.perPage,
          total: data.paging.total,
          hasNextPage: data.paging.hasNextPage,
          results: data.data,
          source: data.source,
        };
      }
      const mal = data as {
        data?: unknown[];
        paging?: { next?: string };
        source: string;
      };
      return {
        page,
        perPage,
        total: mal.data?.length ?? 0,
        hasNextPage: Boolean(mal.paging?.next),
        results: mal.data ?? [],
        source: mal.source,
      };
    }
    return searchAnime(query, page, perPage);
  });
}

export async function animeInfo(anilistId: number) {
  return cached(`anime_info_${anilistId}`, TTL.info, () =>
    getAnimeInfo(anilistId),
  );
}

export async function animeRelations(anilistId: number) {
  return cached(`anime_rel_${anilistId}`, TTL.info, () =>
    getAnimeRelations(anilistId),
  );
}

export async function animeSchedule(date: string, page = 1, perPage = 50) {
  return cached(`anime_schedule_${date}_${page}_${perPage}`, TTL.search, () =>
    getAnimeSchedule(date, page, perPage),
  );
}

export async function jikanAnimeInfo(malId: number) {
  return cached(`jikan_anime_${malId}`, TTL.info, () => getJikanAnime(malId));
}

export async function jikanAnimeTop(page = 1, limit = 20, filter?: string) {
  return cached(`jikan_top_${page}_${limit}_${filter ?? ""}`, TTL.search, () =>
    getJikanAnimeTop(page, limit, filter),
  );
}

export async function jikanSeasonNow(page = 1, limit = 20) {
  return cached(`jikan_season_${page}_${limit}`, TTL.search, () =>
    getJikanSeasonNow(page, limit),
  );
}

export async function kitsuAnimeInfo(id: string | number) {
  return cached(`kitsu_anime_${id}`, TTL.info, () => getKitsuAnime(id));
}

export async function malAnimeInfo(malId: number) {
  return cached(`mal_anime_${malId}`, TTL.info, () => getMalAnime(malId));
}

export async function animeEpisodes(provider: AnimeProviderId, id: string) {
  const key = `anime_ep_${provider}_${id}`;
  return cached(key, TTL.episodes, async () => {
    if (provider === "miruro") {
      return miruroProvider.fetchEpisodes(Number(id));
    }
    if (provider === "anipub") return anipubProvider.getEpisodes(id);
    if (provider === "animethemes") {
      throw new ProviderError(
        "AnimeThemes provides opening/ending themes, not full episodes",
        422,
      );
    }
    return anikotoProvider.getEpisodes(id);
  });
}

export async function animeSources(
  provider: string,
  opts: {
    episodeId?: string;
    serverIds?: string;
    anilistId?: number;
    category?: string;
    slug?: string;
    streamProvider?: string;
  },
) {
  if (provider === "anikoto") {
    if (!opts.serverIds) throw new Error("anikoto requires serverIds");
    const serverIds = opts.serverIds;
    return cached(`anikoto_src_${serverIds}`, TTL.stream, () =>
      anikotoProvider.getSources(serverIds),
    );
  }

  if (provider === "anipub") {
    if (!opts.episodeId)
      throw new ProviderError("anipub requires episodeId", 422);
    return cached(`anipub_src_${opts.episodeId}`, TTL.stream, () =>
      anipubProvider.getSources(opts.episodeId as string),
    );
  }

  if (provider === "animethemes") {
    throw new ProviderError(
      "AnimeThemes media is available from /v1/anime/animethemes/themes/:slug",
      422,
    );
  }

  // Miruro pipe — URL :provider is the stream source (gogo, zoro, …), not "miruro"
  const streamProvider =
    provider !== "miruro" ? provider : (opts.streamProvider ?? "gogo");

  if (opts.slug && opts.anilistId && opts.category) {
    return miruroProvider.resolveWatchSlug(
      streamProvider,
      opts.anilistId,
      opts.category,
      opts.slug,
    );
  }
  if (opts.episodeId && opts.anilistId) {
    return miruroProvider.getSources(
      opts.episodeId,
      streamProvider,
      opts.anilistId,
      opts.category ?? "sub",
    );
  }
  throw new Error(
    "miruro requires episodeId+anilistId or slug+anilistId+category",
  );
}

export async function animeThemeSearch(query: string, limit = 5) {
  const search = await animethemesProvider.search(query, 1, limit);
  const settled = await Promise.allSettled(
    search.results.map((item) => animethemesProvider.getThemes(item.slug)),
  );
  return {
    results: settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    ),
    sources: settled.map((result, index) => ({
      slug: search.results[index]?.slug ?? "",
      status: result.status,
      ...(result.status === "rejected"
        ? { error: errorMessage(result.reason) }
        : {}),
    })),
    total: search.total,
    provider: "animethemes" as const,
  };
}

export async function resolveAnimeEpisode(
  title: string,
  episode: number,
  category = "sub",
) {
  const attempts: Array<Record<string, unknown>> = [];

  try {
    const results = (await anikotoProvider.search(title)) as Array<
      Record<string, unknown>
    >;
    const target = bestTitleMatch(results, title);
    if (!target?.slug) throw new ProviderError("No matching anime", 404);
    const catalog = await anikotoProvider.getEpisodes(String(target.slug));
    const selected = catalog.episodes.find(
      (item) => Number(item.number ?? item.episode_no) === episode,
    );
    const serverIds = String(selected?.server_ids ?? "");
    if (!serverIds)
      throw new ProviderError(`Episode ${episode} not found`, 404);
    const sources = await anikotoProvider.getSources(serverIds);
    if (!sources.streams.length && !sources.embeds.length)
      throw new ProviderError("No playable sources", 502);
    attempts.push({ provider: "anikoto", status: "fulfilled" });
    return {
      title: String(target.title ?? title),
      episode,
      category,
      provider: "anikoto" as const,
      sourceId: String(target.slug),
      sources,
      attempts,
    };
  } catch (error) {
    attempts.push({
      provider: "anikoto",
      status: "rejected",
      error: errorMessage(error),
    });
  }

  try {
    const search = await anipubProvider.search(title, 1, 20);
    const target = bestTitleMatch(
      search.results as Array<Record<string, unknown>>,
      title,
    );
    if (!target?.id) throw new ProviderError("No matching anime", 404);
    const catalog = await anipubProvider.getEpisodes(String(target.id));
    const sameNumber = catalog.episodes.filter(
      (item) => item.number === episode,
    );
    const selected =
      sameNumber.find((item) => item.category === category) ?? sameNumber[0];
    if (!selected) throw new ProviderError(`Episode ${episode} not found`, 404);
    const sources = await anipubProvider.getSources(selected.id);
    if (!sources.streams.length)
      throw new ProviderError("No playable sources", 502);
    attempts.push({ provider: "anipub", status: "fulfilled" });
    return {
      title: String(target.title ?? title),
      episode,
      category,
      provider: "anipub" as const,
      sourceId: String(target.id),
      sources,
      attempts,
    };
  } catch (error) {
    attempts.push({
      provider: "anipub",
      status: "rejected",
      error: errorMessage(error),
    });
  }

  try {
    const metadata = await animeSearch(title, 1, 1, "anilist");
    const media = recordValue(metadata.results[0]);
    const anilistId = Number(media.id);
    if (!anilistId) throw new ProviderError("AniList match not found", 404);
    const catalog = await miruroProvider.fetchEpisodes(anilistId);
    const providerMap = recordValue(catalog.providers);
    for (const [streamProvider, rawProvider] of Object.entries(providerMap)) {
      const episodeMap = recordValue(recordValue(rawProvider).episodes);
      const preferred = Array.isArray(episodeMap[category])
        ? (episodeMap[category] as Array<Record<string, unknown>>)
        : [];
      const alternatives = Object.values(episodeMap).flatMap((value) =>
        Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [],
      );
      const selected = [...preferred, ...alternatives].find(
        (item) => Number(item.number) === episode,
      );
      if (!selected?.id) continue;
      const sources = await miruroProvider.getSources(
        String(selected.id),
        streamProvider,
        anilistId,
        category,
      );
      attempts.push({
        provider: "miruro",
        streamProvider,
        status: "fulfilled",
      });
      return {
        title:
          String(recordValue(media.title).english ?? "") ||
          String(recordValue(media.title).romaji ?? title),
        episode,
        category,
        provider: "miruro" as const,
        streamProvider,
        sourceId: String(anilistId),
        sources,
        attempts,
      };
    }
    throw new ProviderError(`Episode ${episode} not found`, 404);
  } catch (error) {
    attempts.push({
      provider: "miruro",
      status: "rejected",
      error: errorMessage(error),
    });
  }

  throw new ProviderError(
    `No anime source could load episode ${episode}. ${attempts
      .map((attempt) => `${attempt.provider}: ${attempt.error ?? "failed"}`)
      .join("; ")}`,
    502,
  );
}

export { miruroProvider, anikotoProvider, anipubProvider, animethemesProvider };
