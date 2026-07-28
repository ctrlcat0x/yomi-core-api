import { config } from "../config.js";
import { MetadataError } from "../errors/index.js";

export const MEDIA_LIST_FIELDS = `
    id
    idMal
    title { romaji english native }
    coverImage { large extraLarge }
    bannerImage
    format
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    meanScore
    popularity
    favourites
    genres
    source
    countryOfOrigin
    isAdult
    studios(isMain: true) { nodes { name isAnimationStudio } }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    startDate { year month day }
    endDate { year month day }
`;

export const MEDIA_FULL_FIELDS = `
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    coverImage { large extraLarge color }
    bannerImage
    format
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    meanScore
    popularity
    favourites
    trending
    genres
    tags { name rank isMediaSpoiler }
    source
    countryOfOrigin
    isAdult
    hashtag
    synonyms
    siteUrl
    trailer { id site thumbnail }
    studios { nodes { id name isAnimationStudio siteUrl } }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    startDate { year month day }
    endDate { year month day }
    relations {
        edges {
            relationType(version: 2)
            node {
                id
                idMal
                title { romaji english native }
                coverImage { large }
                format
                type
                status
                episodes
                meanScore
            }
        }
    }
    recommendations(sort: RATING_DESC, perPage: 10) {
        nodes {
            rating
            mediaRecommendation {
                id
                title { romaji english native }
                coverImage { large }
                format
                episodes
                status
                meanScore
                averageScore
            }
        }
    }
    externalLinks { url site type }
    streamingEpisodes { title thumbnail url site }
`;

export async function anilistQuery(
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.anilistToken)
    headers.Authorization = `Bearer ${config.anilistToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(config.anilistUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new MetadataError(`AniList HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: unknown[];
    };
    if (json.errors?.length) throw new MetadataError("AniList query failed");
    return json.data ?? {};
  } finally {
    clearTimeout(timer);
  }
}

export async function searchAnime(query: string, page = 1, perPage = 20) {
  const gql = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }`;
  const data = await anilistQuery(gql, { search: query, page, perPage });
  return buildPaginated(data, page, perPage);
}

export async function getAnimeInfo(anilistId: number) {
  const gql = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FULL_FIELDS}
      }
    }`;
  const data = await anilistQuery(gql, { id: anilistId });
  return (data.Media ?? null) as Record<string, unknown> | null;
}

export async function getAnimeRelations(anilistId: number) {
  const gql = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        relations {
          edges {
            relationType(version: 2)
            node {
              id
              idMal
              title { romaji english native }
              coverImage { large }
              format
              type
              status
              episodes
              meanScore
            }
          }
        }
      }
    }`;
  const data = await anilistQuery(gql, { id: anilistId });
  const media = data.Media as Record<string, unknown> | undefined;
  return (media?.relations as Record<string, unknown>) ?? { edges: [] };
}

export async function getAnimeSchedule(date: string, page = 1, perPage = 50) {
  const start = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
  const end = start + 86_400;
  const gql = `
    query ($start: Int, $end: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          airingAt
          episode
          media {
            id
            idMal
            title { romaji english native }
            coverImage { large }
            format
            isAdult
          }
        }
      }
    }`;
  const data = await anilistQuery(gql, { start, end, page, perPage });
  const pageData = (data.Page ?? {}) as Record<string, unknown>;
  const pageInfo = (pageData.pageInfo ?? {}) as Record<string, unknown>;
  return {
    page: (pageInfo.currentPage as number) ?? page,
    perPage: (pageInfo.perPage as number) ?? perPage,
    total: (pageInfo.total as number) ?? 0,
    hasNextPage: (pageInfo.hasNextPage as boolean) ?? false,
    results: (pageData.airingSchedules as unknown[]) ?? [],
  };
}

function buildPaginated(
  data: Record<string, unknown>,
  page: number,
  perPage: number,
) {
  const pageData = (data.Page ?? {}) as Record<string, unknown>;
  const pageInfo = (pageData.pageInfo ?? {}) as Record<string, unknown>;
  return {
    page: (pageInfo.currentPage as number) ?? page,
    perPage: (pageInfo.perPage as number) ?? perPage,
    total: (pageInfo.total as number) ?? 0,
    hasNextPage: (pageInfo.hasNextPage as boolean) ?? false,
    results: (pageData.media as unknown[]) ?? [],
  };
}
