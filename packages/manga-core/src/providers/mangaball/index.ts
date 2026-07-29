import * as cheerio from "cheerio";
import { ProviderError } from "../../../../shared/src";
import type {
  Chapter,
  ChapterData,
  MangaSearchPage,
  Series,
} from "../../types.js";

const BASE = "https://mangaball.net";
const HEADERS = { Referer: `${BASE}/` };

function cookies(response: Response): string {
  const values = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}
async function session(): Promise<{ token: string; cookie: string }> {
  const response = await fetch(BASE, {
    headers: { "User-Agent": "YomiCore/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new ProviderError(`MangaBall HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const token =
    $('meta[name="csrf-token"], meta[name="csrf_token"]').attr("content") ?? "";
  if (!token) throw new ProviderError("MangaBall CSRF token missing");
  return { token, cookie: cookies(response) };
}
async function post(path: string, form: URLSearchParams): Promise<Response> {
  const { token, cookie } = await session();
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "User-Agent": "YomiCore/1.0",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      "X-CSRFToken": token,
      "X-CSRF-Token": token,
    },
    body: form,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new ProviderError(`MangaBall API ${response.status}`);
  return response;
}
const idFromUrl = (value: string) =>
  value.match(/\/title-detail\/([^/?#]+)/)?.[1] ?? "";

export async function searchMangaBall(
  query: string,
  page = 1,
): Promise<MangaSearchPage> {
  const payload = (await (
    await post(
      "/api/v1/smart-search/search/",
      new URLSearchParams({ search_input: query }),
    )
  ).json()) as {
    data?: { manga?: Array<{ img?: string; title?: string; url?: string }> };
  };
  const results = (payload.data?.manga ?? [])
    .map((row) => ({
      id: idFromUrl(row.url ?? ""),
      title: row.title ?? "",
      image: row.img ?? "",
      provider: "mangaball",
      imageHeaders: HEADERS,
    }))
    .filter((item) => item.id && item.title);
  return {
    results,
    pagination: {
      page,
      perPage: results.length,
      total: results.length,
      hasNextPage: false,
    },
  };
}
async function chapterList(id: string, titleId: string): Promise<Chapter[]> {
  if (!titleId) return [];
  const payload = (await (
    await post(
      "/api/v1/chapter/chapter-listing-by-title-id/",
      new URLSearchParams({ title_id: titleId }),
    )
  ).json()) as { ALL_CHAPTERS?: Array<Record<string, unknown>> };
  return (payload.ALL_CHAPTERS ?? []).flatMap((row) => {
    const translations = Array.isArray(row.translations)
      ? (row.translations as Array<Record<string, unknown>>)
      : [];
    const english = translations.filter((item) =>
      String(item.language ?? item.lang ?? "")
        .toLowerCase()
        .startsWith("en"),
    );
    return (english.length ? english : translations).map((item) => {
      const chapterId = String(item.id ?? item.translation_id ?? "");
      const index = String(row.chapter_number ?? row.number ?? "");
      return {
        id: chapterId,
        name: String(row.title ?? `Chapter ${index}`),
        title: null,
        slug: chapterId,
        thumbnail: "",
        price: 0,
        isFree: true,
        createdAt: String(item.created_at ?? ""),
        index,
        url: `/v1/manga/mangaball/pages/${id}/${chapterId}`,
      };
    });
  });
}
export async function getMangaBallSeries(
  id: string,
  includeChapters = false,
): Promise<Series> {
  const response = await fetch(
    `${BASE}/title-detail/${encodeURIComponent(id)}/`,
    {
      headers: { ...HEADERS, "User-Agent": "YomiCore/1.0" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok)
    throw new ProviderError(`MangaBall HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const titleId = $("[data-title-id]").first().attr("data-title-id") ?? "";
  const chapters = includeChapters ? await chapterList(id, titleId) : [];
  const thumbnail =
    $('meta[property="og:image"]').attr("content") ??
    $(".cover img, .manga-cover img").first().attr("src") ??
    "";
  const field = (name: string) =>
    $("dt, .label, .title")
      .filter((_, node) => $(node).text().toLowerCase().includes(name))
      .first()
      .next()
      .text()
      .trim();
  return {
    id,
    title:
      $('meta[property="og:title"]')
        .attr("content")
        ?.replace(/\s+Online Free.*$/i, "") ?? id,
    slug: id,
    description:
      $('meta[name="description"]').attr("content") ??
      $(".description, .summary").first().text().trim(),
    thumbnail,
    cover: thumbnail,
    status: field("status"),
    type: "manga",
    rating: 0,
    totalViews: 0,
    alternativeNames: field("alternative"),
    author: field("author"),
    studio: field("artist"),
    releaseYear: "",
    releaseSchedule: [],
    tags: $('a[href*="genre"]')
      .map((_, node) => $(node).text().trim())
      .get()
      .filter(Boolean),
    chaptersCount: chapters.length,
    bookmarksCount: 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: "",
    chapters,
    url: `${BASE}/title-detail/${id}/`,
    provider: "mangaball",
    imageHeaders: HEADERS,
  };
}
export async function getMangaBallPages(
  seriesId: string,
  chapterId: string,
): Promise<ChapterData> {
  const response = await fetch(
    `${BASE}/chapter-detail/${encodeURIComponent(chapterId)}/`,
    {
      headers: { ...HEADERS, "User-Agent": "YomiCore/1.0" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok)
    throw new ProviderError(`MangaBall HTTP ${response.status}`);
  const body = await response.text();
  const encoded =
    body.match(
      /const\s+chapterImages\s*=\s*JSON\.parse\(`([\s\S]*?)`\)/,
    )?.[1] ?? "[]";
  let images: string[] = [];
  try {
    const parsed = JSON.parse(encoded.replace(/\\`/g, "`"));
    images = Array.isArray(parsed)
      ? parsed
          .map((item) =>
            typeof item === "string"
              ? item
              : String(item.url ?? item.image ?? ""),
          )
          .filter(Boolean)
      : [];
  } catch {
    throw new ProviderError("MangaBall page payload invalid");
  }
  return {
    id: chapterId,
    name: chapterId,
    title: null,
    slug: chapterId,
    index: "",
    price: 0,
    isFree: true,
    thumbnail: images[0] ?? "",
    images,
    pageCount: images.length,
    createdAt: "",
    headerForImage: HEADERS,
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
export const mangaballProvider = {
  id: "mangaball" as const,
  search: searchMangaBall,
  getSeries: getMangaBallSeries,
  getPages: getMangaBallPages,
};
