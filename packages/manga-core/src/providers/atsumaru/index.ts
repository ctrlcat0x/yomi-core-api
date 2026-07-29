import { ProviderError } from "../../../../shared/src";
import type {
  Chapter,
  ChapterData,
  MangaSearchPage,
  MangaSearchResult,
  Series,
} from "../../types.js";

const BASE = "https://atsu.moe";
const IMAGE_HEADERS = { Referer: `${BASE}/` };

type AtsuChapter = {
  id: string;
  title?: string;
  number?: number | string;
  createdAt?: number | string;
  pageCount?: number;
};

type AtsuManga = {
  id: string;
  title: string;
  image?: string | null;
  smallImage?: string | null;
  poster?:
    | string
    | {
        image?: string;
        largeImage?: string;
        mediumImage?: string;
        smallImage?: string;
      };
  banner?: { url?: string };
  description?: string | null;
  status?: string;
  type?: string;
  authors?: Array<string | { name?: string; type?: string }>;
  genres?: Array<string | { name?: string }>;
  chapterCount?: number;
  chaptersCount?: number;
  mbRating?: number;
  views?: number | string;
  released?: number | string;
  altTitles?: string[];
  alternativeTitles?: string[];
};

async function fetchAtsu<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Referer: `${BASE}/`,
      "User-Agent": "YomiCore/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new ProviderError(`Atsumaru API error: ${response.status}`);
  return response.json() as Promise<T>;
}

function imageUrl(value?: string | null): string {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  return `${BASE}/static/${value.replace(/^\/?static\//, "").replace(/^\//, "")}`;
}

function posterUrl(manga: AtsuManga): string {
  if (typeof manga.poster === "string") return imageUrl(manga.poster);
  return imageUrl(
    manga.poster?.largeImage ??
      manga.poster?.mediumImage ??
      manga.poster?.image ??
      manga.poster?.smallImage ??
      manga.image ??
      manga.smallImage,
  );
}

function parseViews(value?: number | string): number {
  if (typeof value === "number") return value;
  const match = value?.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match?.[1]) return Number(value) || 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() ?? ""] ?? 1;
  return Number(match[1]) * scale;
}

function chapterKey(chapter: AtsuChapter): string {
  return (chapter.title || `chapter ${chapter.number ?? chapter.id}`)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAtsumaruChapters(
  chapters: AtsuChapter[],
  seriesId: string,
): Chapter[] {
  const groups = new Map<string, AtsuChapter[]>();
  for (const chapter of chapters) {
    const key = chapterKey(chapter);
    groups.set(key, [...(groups.get(key) ?? []), chapter]);
  }
  return [...groups.values()].map((variants) => {
    variants.sort(
      (left, right) =>
        Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0) ||
        Number(right.pageCount ?? 0) - Number(left.pageCount ?? 0),
    );
    return toChapter(
      variants[0] as AtsuChapter,
      seriesId,
      variants.map(({ id }) => id),
    );
  });
}

function toChapter(
  chapter: AtsuChapter,
  seriesId: string,
  variantIds = [chapter.id],
): Chapter {
  const index = String(chapter.number ?? "");
  const createdAt = chapter.createdAt
    ? new Date(Number(chapter.createdAt)).toISOString()
    : "";
  return {
    id: chapter.id,
    name: chapter.title || (index ? `Chapter ${index}` : chapter.id),
    title: null,
    slug: variantIds.join("~"),
    thumbnail: "",
    price: 0,
    isFree: true,
    createdAt,
    index,
    url: `/v1/manga/atsumaru/pages/${seriesId}/${variantIds.join("~")}`,
  };
}

export async function searchAtsumaru(
  query: string,
  page = 1,
): Promise<MangaSearchPage> {
  const perPage = 20;
  const params = new URLSearchParams({
    q: query,
    query_by: "title",
    page: String(page),
    per_page: String(perPage),
  });
  const data = await fetchAtsu<{
    found?: number;
    hits?: Array<{ document?: AtsuManga }>;
  }>(`/collections/manga/documents/search?${params}`);
  const items = (data.hits ?? [])
    .map(({ document }) => document)
    .filter((item): item is AtsuManga => Boolean(item?.id && item.title));
  return {
    results: items.map(
      (manga): MangaSearchResult => ({
        id: manga.id,
        title: manga.title,
        image: posterUrl(manga),
        provider: "atsumaru",
        imageHeaders: IMAGE_HEADERS,
      }),
    ),
    pagination: {
      page,
      perPage,
      total: data.found ?? items.length,
      hasNextPage: page * perPage < (data.found ?? items.length),
    },
  };
}

export async function getAtsumaruSeries(
  id: string,
  includeChapters = false,
): Promise<Series> {
  const [{ mangaPage }, chapterData] = await Promise.all([
    fetchAtsu<{ mangaPage: AtsuManga }>(
      `/api/manga/page?id=${encodeURIComponent(id)}`,
    ),
    includeChapters
      ? fetchAtsu<{ chapters?: AtsuChapter[] }>(
          `/api/manga/allChapters?mangaId=${encodeURIComponent(id)}`,
        )
      : Promise.resolve({ chapters: [] }),
  ]);
  const chapters = normalizeAtsumaruChapters(chapterData.chapters ?? [], id);
  const people = mangaPage.authors ?? [];
  const author = people
    .filter((person) => typeof person === "string" || person.type === "Author")
    .map((person) => (typeof person === "string" ? person : person.name))
    .filter(Boolean)
    .join(", ");
  const artist = people
    .filter((person) => typeof person !== "string" && person.type === "Artist")
    .map((person) => (typeof person === "string" ? person : person.name))
    .filter(Boolean)
    .join(", ");
  const thumbnail = posterUrl(mangaPage);
  return {
    id: mangaPage.id,
    title: mangaPage.title,
    slug: mangaPage.id,
    description: mangaPage.description ?? "",
    thumbnail,
    cover: imageUrl(mangaPage.banner?.url) || thumbnail,
    status: mangaPage.status ?? "",
    type: mangaPage.type ?? "manga",
    rating: mangaPage.mbRating ?? 0,
    totalViews: parseViews(mangaPage.views),
    alternativeNames: [
      ...(mangaPage.altTitles ?? []),
      ...(mangaPage.alternativeTitles ?? []),
    ].join(", "),
    author,
    studio: artist,
    releaseYear: mangaPage.released
      ? String(new Date(Number(mangaPage.released)).getUTCFullYear())
      : "",
    releaseSchedule: [],
    tags: (mangaPage.genres ?? [])
      .map((genre) => (typeof genre === "string" ? genre : genre.name))
      .filter((name): name is string => Boolean(name)),
    chaptersCount:
      mangaPage.chaptersCount ?? mangaPage.chapterCount ?? chapters.length,
    bookmarksCount: 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: "",
    chapters,
    url: `${BASE}/manga/${mangaPage.id}`,
    provider: "atsumaru",
    imageHeaders: IMAGE_HEADERS,
  };
}

export async function getAtsumaruPages(
  seriesId: string,
  chapterId: string,
): Promise<ChapterData> {
  const variants = chapterId.split("~").filter(Boolean);
  let selected: {
    id: string;
    title?: string;
    pages?: Array<{ image?: string }>;
  } | null = null;
  const errors: string[] = [];
  for (const variantId of variants) {
    try {
      const params = new URLSearchParams({
        mangaId: seriesId,
        chapterId: variantId,
      });
      const { readChapter } = await fetchAtsu<{
        readChapter: {
          id: string;
          title?: string;
          pages?: Array<{ image?: string }>;
        };
      }>(`/api/read/chapter?${params}`);
      if (readChapter.pages?.some(({ image }) => image)) {
        selected = readChapter;
        break;
      }
      errors.push(`${variantId}: no pages`);
    } catch (error) {
      errors.push(
        `${variantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!selected)
    throw new ProviderError(
      `Atsumaru chapter variants failed: ${errors.join("; ")}`,
    );
  const images = (selected.pages ?? [])
    .map(({ image }) => imageUrl(image))
    .filter(Boolean);
  return {
    id: selected.id,
    name: selected.title ?? "",
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

export const atsumaruProvider = {
  id: "atsumaru" as const,
  search: searchAtsumaru,
  getSeries: getAtsumaruSeries,
  getPages: getAtsumaruPages,
};
