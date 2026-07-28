import { MetadataError } from "../errors/index.js";

const KITSU_BASE = "https://kitsu.io/api/edge";

type KitsuResource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

type KitsuListResponse = {
  data?: KitsuResource[];
  meta?: { count?: number };
  links?: { next?: string };
};

type KitsuItemResponse = {
  data?: KitsuResource | null;
};

async function kitsuFetch(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${KITSU_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new MetadataError(`Kitsu HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    if (err instanceof MetadataError) throw err;
    throw new MetadataError(
      err instanceof Error ? err.message : "Kitsu request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

function normalizeResource(
  resource: KitsuResource | null | undefined,
): Record<string, unknown> | null {
  if (!resource) return null;
  return {
    id: resource.id,
    type: resource.type,
    ...(resource.attributes ?? {}),
  };
}

function buildPaginated(json: KitsuListResponse, page: number, limit: number) {
  const results = (json.data ?? []).map((item) => normalizeResource(item));
  const total = json.meta?.count ?? results.length;
  return {
    page,
    perPage: limit,
    total,
    hasNextPage: Boolean(json.links?.next) || page * limit < total,
    results,
  };
}

export async function searchKitsuAnime(query: string, page = 1, limit = 20) {
  const offset = Math.max(0, (page - 1) * limit);
  const json = (await kitsuFetch("/anime", {
    "filter[text]": query,
    "page[limit]": String(limit),
    "page[offset]": String(offset),
  })) as KitsuListResponse;
  return buildPaginated(json, page, limit);
}

export async function getKitsuAnime(id: string | number) {
  const json = (await kitsuFetch(`/anime/${id}`)) as KitsuItemResponse;
  return normalizeResource(json.data);
}

export async function searchKitsuManga(query: string, page = 1, limit = 20) {
  const offset = Math.max(0, (page - 1) * limit);
  const json = (await kitsuFetch("/manga", {
    "filter[text]": query,
    "page[limit]": String(limit),
    "page[offset]": String(offset),
  })) as KitsuListResponse;
  return buildPaginated(json, page, limit);
}

export async function getKitsuManga(id: string | number) {
  const json = (await kitsuFetch(`/manga/${id}`)) as KitsuItemResponse;
  return normalizeResource(json.data);
}
