import { ProviderError, config } from "@yomi/shared";

const BASE_URL = "https://api.animethemes.moe";

export const ANIMETHEMES_PROVENANCE = {
  name: "animethemes",
  tier: "A",
  kind: "official-project-api",
  canonical: false,
} as const;

type AnimeThemesVideo = {
  id?: number;
  basename?: string;
  filename?: string;
  link?: string;
  resolution?: number;
  size?: number;
  source?: string;
  subbed?: boolean;
  lyrics?: boolean;
  nc?: boolean;
  tags?: string;
};

type AnimeThemeEntry = {
  id?: number;
  episodes?: string | null;
  notes?: string | null;
  nsfw?: boolean;
  spoiler?: boolean;
  version?: number;
  videos?: AnimeThemesVideo[];
};

type AnimeTheme = {
  id?: number;
  type?: string;
  sequence?: number;
  slug?: string;
  animethemeentries?: AnimeThemeEntry[];
};

type AnimeThemesAnime = {
  id?: number;
  name?: string;
  slug?: string;
  year?: number;
  season?: string;
  media_format?: string;
  synopsis?: string;
  animethemes?: AnimeTheme[];
};

type SearchResponse = { search?: { anime?: AnimeThemesAnime[] } };
type AnimeResponse = { anime?: AnimeThemesAnime };

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": config.userAgent,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new ProviderError(`AnimeThemes HTTP ${response.status}: ${path}`);
  }
  return (await response.json()) as T;
}

function normalizeAnime(anime: AnimeThemesAnime) {
  const id = anime.slug ?? String(anime.id ?? "");
  return {
    id,
    slug: anime.slug ?? id,
    title: anime.name ?? "Unknown",
    description: anime.synopsis ?? "",
    year: anime.year ?? null,
    season: anime.season ?? null,
    format: anime.media_format ?? null,
    provider: "animethemes" as const,
    sourceIds: { animethemes: anime.id ?? null },
    provenance: ANIMETHEMES_PROVENANCE,
  };
}

export async function searchAnimeThemes(query: string, page = 1, perPage = 20) {
  const response = await fetchJson<SearchResponse>(
    `/search?q=${encodeURIComponent(query)}`,
  );
  const items = Array.isArray(response.search?.anime)
    ? response.search.anime.map(normalizeAnime).filter((item) => item.id)
    : [];
  const offset = (page - 1) * perPage;
  return {
    page,
    perPage,
    total: items.length,
    hasNextPage: offset + perPage < items.length,
    results: items.slice(offset, offset + perPage),
    source: "animethemes" as const,
  };
}

export async function getAnimeThemesInfo(slug: string) {
  const response = await fetchJson<AnimeResponse>(
    `/anime/${encodeURIComponent(slug)}?include=animethemes.animethemeentries.videos`,
  );
  if (!response.anime)
    throw new ProviderError("AnimeThemes anime not found", 404);
  return {
    ...normalizeAnime(response.anime),
    themes: flattenAnimeThemes(response.anime),
  };
}

export function flattenAnimeThemes(anime: AnimeThemesAnime) {
  return (anime.animethemes ?? []).flatMap((theme) =>
    (theme.animethemeentries ?? []).flatMap((entry) =>
      (entry.videos ?? []).flatMap((video) => {
        if (!video.link) return [];
        return [
          {
            id: `${theme.id ?? theme.slug}:${entry.id ?? entry.version}:${video.id ?? video.filename}`,
            type: theme.type ?? "UNKNOWN",
            sequence: theme.sequence ?? 1,
            slug: theme.slug ?? "",
            episodes: entry.episodes ?? null,
            version: entry.version ?? 1,
            notes: entry.notes ?? null,
            isNsfw: entry.nsfw ?? false,
            isSpoiler: entry.spoiler ?? false,
            video: {
              url: video.link,
              format: "webm",
              resolution: video.resolution ?? null,
              size: video.size ?? null,
              source: video.source ?? null,
              subbed: video.subbed ?? false,
              lyrics: video.lyrics ?? false,
              creditless: video.nc ?? false,
              tags: video.tags?.split(" ").filter(Boolean) ?? [],
            },
            provider: "animethemes" as const,
            provenance: ANIMETHEMES_PROVENANCE,
          },
        ];
      }),
    ),
  );
}

export async function getAnimeThemeMedia(slug: string) {
  const info = await getAnimeThemesInfo(slug);
  return {
    anime: {
      id: info.id,
      slug: info.slug,
      title: info.title,
      year: info.year,
    },
    total: info.themes.length,
    themes: info.themes,
    provider: "animethemes" as const,
    provenance: ANIMETHEMES_PROVENANCE,
  };
}

export const animethemesProvider = {
  id: "animethemes" as const,
  search: searchAnimeThemes,
  getInfo: getAnimeThemesInfo,
  getThemes: getAnimeThemeMedia,
};
