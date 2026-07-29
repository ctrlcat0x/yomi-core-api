import { ProviderError } from "../../../../shared/src";
import type {
  Chapter,
  ChapterData,
  MangaSearchPage,
  MangaSearchResult,
  Series,
} from "../../types.js";

const API_BASE = "https://api.mangak.io";
const SITE_BASE = "https://mangak.io";
const IMAGE_HEADERS = { Referer: `${SITE_BASE}/` };

type MangaKEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type MangaKPerson = { name?: string };
type MangaKTag = { name?: string };
type MangaKStats = {
  views?: number;
  bookmarks_count?: number;
  chapters_count?: number;
};

type MangaKTitle = {
  id: string;
  url?: string;
  name: string;
  cover?: string;
  summary?: string;
  status?: string;
  type?: string | { name?: string };
  rating?: number | string | null;
  alt_name?: string;
  authors?: MangaKPerson[] | null;
  artists?: MangaKPerson[] | null;
  genres?: MangaKTag[] | null;
  tags?: MangaKTag[] | null;
  release_date?: string | number | null;
  updated_at?: string;
  stats?: MangaKStats;
};

type MangaKChapter = {
  id: string;
  name?: string;
  slug?: string;
  updated_at?: string;
  images?: string[];
};

type MangaKPagination = {
  total?: number;
  page?: number;
  limit?: number;
  has_next?: boolean;
};

async function fetchMangaK<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Origin: SITE_BASE,
      Referer: `${SITE_BASE}/`,
      "User-Agent": "YomiCore/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new ProviderError(`MangaK API error: ${response.status}`);
  }
  const envelope = (await response.json()) as MangaKEnvelope<T>;
  if (!envelope.success) {
    throw new ProviderError(envelope.message || "MangaK request failed");
  }
  return envelope.data;
}

function names(values?: MangaKPerson[] | null): string {
  return (values ?? [])
    .map(({ name }) => name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ");
}

function chapterIndex(chapter: MangaKChapter): string {
  return (
    chapter.name?.match(/(?:chapter|ch\.?)[\s_-]*(\d+(?:\.\d+)?)/i)?.[1] ??
    chapter.slug?.match(/chapter-(\d+(?:\.\d+)?)/i)?.[1] ??
    ""
  );
}

function toChapter(chapter: MangaKChapter, seriesId: string): Chapter {
  const index = chapterIndex(chapter);
  return {
    id: chapter.id,
    name: chapter.name || (index ? `Chapter ${index}` : chapter.id),
    title: null,
    slug: chapter.id,
    thumbnail: "",
    price: 0,
    isFree: true,
    createdAt: chapter.updated_at ?? "",
    index,
    url: `/v1/manga/mangak/pages/${seriesId}/${chapter.id}`,
  };
}

export async function searchMangaK(
  query: string,
  page = 1,
): Promise<MangaSearchPage> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const data = await fetchMangaK<{
    items: MangaKTitle[];
    pagination?: MangaKPagination;
  }>(`/titles/search?${params}`);
  const pagination = data.pagination;
  const perPage = pagination?.limit ?? 20;
  return {
    results: data.items.map(
      (title): MangaSearchResult => ({
        id: title.id,
        title: title.name,
        image: title.cover ?? "",
        provider: "mangak",
        imageHeaders: IMAGE_HEADERS,
      }),
    ),
    pagination: {
      page: pagination?.page ?? page,
      perPage,
      total: pagination?.total ?? data.items.length,
      hasNextPage: pagination?.has_next ?? data.items.length === perPage,
    },
  };
}

export async function getMangaKSeries(
  id: string,
  includeChapters = false,
): Promise<Series> {
  const [{ title }, chapterData] = await Promise.all([
    fetchMangaK<{ title: MangaKTitle }>(`/titles/${encodeURIComponent(id)}`),
    includeChapters
      ? fetchMangaK<{ chapters: MangaKChapter[] }>(
          `/titles/${encodeURIComponent(id)}/chapters`,
        )
      : Promise.resolve({ chapters: [] }),
  ]);
  const chapters = chapterData.chapters.map((chapter) =>
    toChapter(chapter, id),
  );
  const tags = [...(title.genres ?? []), ...(title.tags ?? [])]
    .map(({ name }) => name?.trim())
    .filter((name): name is string => Boolean(name));
  const type =
    typeof title.type === "string" ? title.type : (title.type?.name ?? "manga");

  return {
    id: title.id,
    title: title.name,
    slug: title.url?.replace(/^\//, "") || title.id,
    description: title.summary ?? "",
    thumbnail: title.cover ?? "",
    cover: title.cover ?? "",
    status: title.status ?? "",
    type,
    rating: Number(title.rating) || 0,
    totalViews: title.stats?.views ?? 0,
    alternativeNames: title.alt_name ?? "",
    author: names(title.authors),
    studio: names(title.artists),
    releaseYear: String(title.release_date ?? ""),
    releaseSchedule: [],
    tags: [...new Set(tags)],
    chaptersCount: title.stats?.chapters_count ?? chapters.length,
    bookmarksCount: title.stats?.bookmarks_count ?? 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: title.updated_at ?? "",
    chapters,
    url: `${SITE_BASE}${title.url ?? `/${title.id}`}`,
    provider: "mangak",
    imageHeaders: IMAGE_HEADERS,
  };
}

export async function getMangaKPages(
  seriesId: string,
  chapterId: string,
): Promise<ChapterData> {
  const data = await fetchMangaK<{ images?: string[] }>(
    `/titles/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/images`,
  );
  const images = data.images ?? [];
  return {
    id: chapterId,
    name: "",
    title: null,
    slug: chapterId,
    index: "",
    price: 0,
    isFree: true,
    thumbnail: images[0] ?? "",
    images,
    pageCount: images.length,
    createdAt: "",
    headerForImage: IMAGE_HEADERS,
    series: {
      id: seriesId,
      title: "",
      slug: seriesId,
      thumbnail: "",
      status: "",
      description: "",
    },
  };
}

export const mangakProvider = {
  id: "mangak" as const,
  search: searchMangaK,
  getSeries: getMangaKSeries,
  getPages: getMangaKPages,
};
