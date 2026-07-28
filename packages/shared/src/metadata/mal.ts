import { config } from "../config.js";
import { MetadataError } from "../errors/index.js";
import { getJikanAnime, searchJikanAnime } from "./jikan.js";

const MAL_BASE = "https://api.myanimelist.net/v2";

export async function malFetch(path: string, params?: Record<string, string>) {
  if (!config.malClientId) {
    throw new MetadataError(
      "MAL_CLIENT_ID is required for MyAnimeList requests",
    );
  }

  const url = new URL(`${MAL_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      "X-MAL-CLIENT-ID": config.malClientId,
    },
  });

  if (!res.ok) throw new MetadataError(`MAL HTTP ${res.status}`);
  return res.json();
}

/** Official MAL when `MAL_CLIENT_ID` set; otherwise Jikan (no key). */
export async function searchMalAnime(query: string, limit = 20, offset = 0) {
  if (!config.malClientId) {
    const page = Math.floor(offset / limit) + 1;
    const data = await searchJikanAnime(query, page, limit);
    return {
      source: "jikan" as const,
      data: data.results,
      paging: {
        page: data.page,
        perPage: data.perPage,
        total: data.total,
        hasNextPage: data.hasNextPage,
      },
    };
  }

  const data = await malFetch("/anime", {
    q: query,
    limit: String(limit),
    offset: String(offset),
    fields:
      "id,title,main_picture,mean,rank,media_type,status,num_episodes,start_date",
  });
  return { source: "mal" as const, ...(data as Record<string, unknown>) };
}

/** Official MAL when `MAL_CLIENT_ID` set; otherwise Jikan (no key). */
export async function getMalAnime(malId: number) {
  if (!config.malClientId) {
    const data = await getJikanAnime(malId);
    return { source: "jikan" as const, data };
  }

  const data = await malFetch(`/anime/${malId}`, {
    fields:
      "id,title,main_picture,mean,rank,media_type,status,num_episodes,start_date,synopsis,related_anime",
  });
  return { source: "mal" as const, ...(data as Record<string, unknown>) };
}
