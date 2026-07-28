import { ProviderError, TTL, cached } from "@yomi/shared";
import type {
  Chapter,
  ChapterData,
  MangaSearchResult,
  Series,
} from "../../types.js";

const OMEGA_BASE = "https://api.omegascans.org";

async function fetchOmega<T>(path: string, retries = 1): Promise<T> {
  const url = `${OMEGA_BASE}${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "YomiCore/1.0", Accept: "application/json" },
      });
      if (res.ok) return res.json() as Promise<T>;
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new ProviderError(`OmegaScans API error: ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastError ?? new ProviderError("OmegaScans API error");
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `https://media.omegascans.org/${url.replace(/^\//, "")}`;
}

function toSeries(
  raw: Record<string, unknown>,
  chapters: Chapter[] = [],
): Series {
  const schedule = raw.release_schedule as Record<string, boolean> | undefined;
  const days = Object.entries(schedule ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

  return {
    id: raw.id as number,
    title: String(raw.title ?? ""),
    slug: String(raw.series_slug ?? ""),
    description: stripHtml(String(raw.description ?? "")),
    thumbnail: normalizeImageUrl(String(raw.thumbnail ?? "")),
    cover: normalizeImageUrl(String(raw.thumbnail ?? "")),
    status: String(raw.status ?? ""),
    type: String(raw.series_type ?? "manga"),
    rating: Math.round(Number(raw.rating ?? 0) * 100) / 100,
    totalViews: Number(raw.total_views ?? 0),
    alternativeNames: String(raw.alternative_names ?? ""),
    author: String(raw.author ?? ""),
    studio: String(raw.studio ?? ""),
    releaseYear: String(raw.release_year ?? ""),
    releaseSchedule: days,
    tags: Array.isArray(raw.tags)
      ? (raw.tags as Array<{ name: string } | string>).map((t) =>
          typeof t === "string" ? t : t.name,
        )
      : [],
    chaptersCount: Number(
      (raw.meta as Record<string, string>)?.chapters_count ?? chapters.length,
    ),
    bookmarksCount: Number(
      (raw.meta as Record<string, string>)?.who_bookmarked_count ?? 0,
    ),
    isComingSoon: Boolean(raw.is_coming_soon),
    badge: (raw.badge as string) ?? null,
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    chapters,
    url: `/v1/manga/omegascans/series/${raw.series_slug}`,
    provider: "omegascans",
  };
}

function toChapter(ch: Record<string, unknown>, seriesSlug: string): Chapter {
  return {
    id: ch.id as number,
    name: String(ch.chapter_name ?? ""),
    title: (ch.chapter_title as string) ?? null,
    slug: String(ch.chapter_slug ?? ""),
    thumbnail: normalizeImageUrl(String(ch.chapter_thumbnail ?? "")),
    price: Number(ch.price ?? 0),
    isFree: Number(ch.price ?? 0) === 0,
    createdAt: String(ch.created_at ?? ""),
    index: String((ch.meta as Record<string, string>)?.index ?? ""),
    url: `/v1/manga/omegascans/pages/${seriesSlug}/${ch.chapter_slug}`,
  };
}

type OmegaCatalog = {
  meta: Record<string, number>;
  data: Record<string, unknown>[];
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSearchFields(series: Record<string, unknown>): string[] {
  const tags = Array.isArray(series.tags)
    ? (series.tags as Array<{ name?: string } | string>).map((tag) =>
        typeof tag === "string" ? tag : String(tag.name ?? ""),
      )
    : [];

  return [
    String(series.title ?? ""),
    String(series.alternative_names ?? ""),
    String(series.author ?? ""),
    String(series.studio ?? ""),
    ...tags,
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

function getSearchRank(series: Record<string, unknown>, query: string): number {
  const fields = getSearchFields(series);
  const title = fields[0] ?? "";
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (fields.some((field) => field === query)) return 3;
  if (fields.some((field) => field.includes(query))) return 4;

  const tokens = query.split(" ").filter(Boolean);
  return tokens.length > 0 &&
    tokens.every((token) => fields.some((field) => field.includes(token)))
    ? 5
    : Number.POSITIVE_INFINITY;
}

async function getOmegaCatalog(): Promise<OmegaCatalog> {
  return cached("omegascans_catalog", TTL.manga, () =>
    fetchOmega<OmegaCatalog>("/query?type=series&page=1&perPage=1000"),
  );
}

export async function searchOmega(query: string, page = 1) {
  const normalizedQuery = normalizeSearchText(query);
  const data = await getOmegaCatalog();
  const perPage = 20;
  const currentPage = Math.max(1, Math.trunc(page));
  const matches = data.data
    .map((series) => ({ series, rank: getSearchRank(series, normalizedQuery) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        String(left.series.title ?? "").localeCompare(
          String(right.series.title ?? ""),
        ),
    )
    .map(({ series }) => series);
  const offset = (currentPage - 1) * perPage;
  const results = matches.slice(offset, offset + perPage);

  return {
    results: results.map(
      (series): MangaSearchResult => ({
        id: String(series.series_slug ?? series.id ?? ""),
        title: String(series.title ?? ""),
        image: normalizeImageUrl(String(series.thumbnail ?? "")),
        provider: "omegascans",
      }),
    ),
    pagination: {
      page: currentPage,
      perPage,
      total: matches.length,
      hasNextPage: offset + perPage < matches.length,
    },
  };
}

export async function getOmegaSeries(
  slug: string,
  includeChapters = false,
): Promise<Series> {
  const detail = await fetchOmega<Record<string, unknown>>(`/series/${slug}`);
  let chapters: Chapter[] = [];
  if (includeChapters) {
    const chData = await fetchOmega<{ data: Record<string, unknown>[] }>(
      `/chapter/query?page=1&perPage=10000&series_id=${detail.id}`,
    );
    chapters = chData.data.map((ch) => toChapter(ch, slug));
  }
  return toSeries(detail, chapters);
}

export async function getOmegaChapters(
  seriesId: number,
  seriesSlug: string,
): Promise<Chapter[]> {
  const data = await fetchOmega<{ data: Record<string, unknown>[] }>(
    `/chapter/query?page=1&perPage=10000&series_id=${seriesId}`,
  );
  return data.data.map((ch) => toChapter(ch, seriesSlug));
}

export async function getOmegaPages(
  seriesSlug: string,
  chapterSlug: string,
): Promise<ChapterData> {
  const data = await fetchOmega<{ chapter: Record<string, unknown> }>(
    `/chapter/${seriesSlug}/${chapterSlug}`,
  );
  const ch = data.chapter;
  const rawImages = ((ch.chapter_data as Record<string, string[]>)?.images ??
    []) as string[];
  const images = rawImages.map(normalizeImageUrl);
  const series = ch.series as Record<string, unknown>;

  return {
    id: ch.id as number,
    name: String(ch.chapter_name ?? ""),
    title: (ch.chapter_title as string) ?? null,
    slug: String(ch.chapter_slug ?? ""),
    index: String(ch.index ?? ""),
    price: Number(ch.price ?? 0),
    isFree: Number(ch.price ?? 0) === 0,
    thumbnail: normalizeImageUrl(String(ch.chapter_thumbnail ?? "")),
    images,
    pageCount: images.length,
    createdAt: String(ch.created_at ?? ""),
    series: {
      id: series.id as number,
      title: String(series.title ?? ""),
      slug: String(series.series_slug ?? ""),
      thumbnail: normalizeImageUrl(String(series.thumbnail ?? "")),
      status: String(series.status ?? ""),
      description: stripHtml(String(series.description ?? "")),
    },
  };
}

export const omegascansProvider = {
  id: "omegascans" as const,
  search: searchOmega,
  getSeries: getOmegaSeries,
  getChapters: getOmegaChapters,
  getPages: getOmegaPages,
};
