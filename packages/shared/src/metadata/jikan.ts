import { MetadataError } from "../errors/index.js";

const JIKAN_BASE = "https://api.jikan.moe/v4";
const JIKAN_REQUEST_INTERVAL_MS = 350;

let jikanQueue = Promise.resolve();
let lastJikanRequestAt = 0;

type JikanListResponse = {
  data?: unknown[];
  pagination?: {
    last_visible_page?: number;
    has_next_page?: boolean;
    current_page?: number;
    items?: { count?: number; total?: number; per_page?: number };
  };
};

type JikanItemResponse = {
  data?: Record<string, unknown>;
};

async function jikanFetch(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${JIKAN_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const previous = jikanQueue;
  let releaseQueue = () => {};
  jikanQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;

  try {
    const delay = Math.max(
      0,
      JIKAN_REQUEST_INTERVAL_MS - (Date.now() - lastJikanRequestAt),
    );
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    for (let attempt = 0; attempt < 3; attempt++) {
      lastJikanRequestAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (res.ok) return res.json();

        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === 2) {
          throw new MetadataError(`Jikan HTTP ${res.status}`, res.status);
        }

        const retryAfter = Number(res.headers.get("retry-after"));
        const retryDelay = Number.isFinite(retryAfter)
          ? Math.max(350, retryAfter * 1000)
          : 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } catch (err) {
        if (err instanceof MetadataError) throw err;
        if (attempt === 2) {
          throw new MetadataError(
            err instanceof Error ? err.message : "Jikan request failed",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new MetadataError("Jikan request failed");
  } finally {
    releaseQueue();
  }
}

function buildPaginated(json: JikanListResponse, page: number, limit: number) {
  const pagination = json.pagination ?? {};
  const items = pagination.items ?? {};
  return {
    page: pagination.current_page ?? page,
    perPage: items.per_page ?? limit,
    total: items.total ?? json.data?.length ?? 0,
    hasNextPage: pagination.has_next_page ?? false,
    results: json.data ?? [],
  };
}

export async function searchJikanAnime(query: string, page = 1, limit = 20) {
  const json = (await jikanFetch("/anime", {
    q: query,
    page: String(page),
    limit: String(limit),
  })) as JikanListResponse;
  return buildPaginated(json, page, limit);
}

export async function getJikanAnime(malId: number) {
  const json = (await jikanFetch(`/anime/${malId}/full`)) as JikanItemResponse;
  return json.data ?? null;
}

export async function getJikanAnimeTop(page = 1, limit = 20, filter?: string) {
  const params: Record<string, string> = {
    page: String(page),
    limit: String(limit),
  };
  if (filter) params.filter = filter;
  const json = (await jikanFetch("/top/anime", params)) as JikanListResponse;
  return buildPaginated(json, page, limit);
}

export async function getJikanSeasonNow(page = 1, limit = 20) {
  const json = (await jikanFetch("/seasons/now", {
    page: String(page),
    limit: String(limit),
  })) as JikanListResponse;
  return buildPaginated(json, page, limit);
}

export async function searchJikanManga(query: string, page = 1, limit = 20) {
  const json = (await jikanFetch("/manga", {
    q: query,
    page: String(page),
    limit: String(limit),
  })) as JikanListResponse;
  return buildPaginated(json, page, limit);
}

export async function getJikanManga(malId: number) {
  const json = (await jikanFetch(`/manga/${malId}/full`)) as JikanItemResponse;
  return json.data ?? null;
}
