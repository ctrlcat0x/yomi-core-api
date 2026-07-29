import * as cheerio from "cheerio";
import { ProviderError } from "../../../../shared/src";
import type {
  Chapter,
  ChapterData,
  MangaSearchPage,
  Series,
} from "../../types.js";

const BASE = "https://mangakatana.com";
const HEADERS = { Referer: `${BASE}/` };

async function html(path: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { ...HEADERS, "User-Agent": "YomiCore/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new ProviderError(`MangaKatana HTTP ${response.status}`);
  return response.text();
}

const slug = (href: string) => href.match(/\/manga\/([^/?#]+)/)?.[1] ?? "";

export async function searchMangaKatana(
  query: string,
  page = 1,
): Promise<MangaSearchPage> {
  const body = await html(
    `/?search=${encodeURIComponent(query)}&search_by=book_name${page > 1 ? `&page=${page}` : ""}`,
  );
  const $ = cheerio.load(body);
  const results: MangaSearchPage["results"] = [];
  const seen = new Set<string>();
  $('h3 a[href*="/manga/"], h1 a[href*="/manga/"]').each((_, node) => {
    const anchor = $(node);
    const id = slug(anchor.attr("href") ?? "");
    if (!id || seen.has(id)) return;
    const item = anchor.closest(".item, .book, .row");
    const image =
      item.find("img").first().attr("data-src") ??
      item.find("img").first().attr("src") ??
      "";
    seen.add(id);
    results.push({
      id,
      title: anchor.text().trim(),
      image,
      provider: "mangakatana",
      imageHeaders: HEADERS,
    });
  });
  return {
    results,
    pagination: {
      page,
      perPage: results.length || 20,
      total: results.length,
      hasNextPage: $("a.next, .next-page").length > 0,
    },
  };
}

export async function getMangaKatanaSeries(
  id: string,
  includeChapters = false,
): Promise<Series> {
  const body = await html(`/manga/${encodeURIComponent(id)}`);
  const $ = cheerio.load(body);
  const chapters: Chapter[] = includeChapters
    ? $("tr")
        .filter((_, row) => $(row).find(".chapter").length > 0)
        .map((_, row) => {
          const anchor = $(row).find(".chapter a, a.chapter").first();
          const href = anchor.attr("href") ?? "";
          const chapterSlug = href.split("/").filter(Boolean).pop() ?? "";
          const index = anchor.text().match(/[\d.]+/)?.[0] ?? "";
          return {
            id: chapterSlug,
            name: anchor.text().trim(),
            title: null,
            slug: chapterSlug,
            thumbnail: "",
            price: 0,
            isFree: true,
            createdAt: $(row).find(".update_time").text().trim(),
            index,
            url: `/v1/manga/mangakatana/pages/${id}/${chapterSlug}`,
          };
        })
        .get()
    : [];
  const value = (selector: string) =>
    $(selector)
      .map((_, node) => $(node).text().trim())
      .get()
      .filter(Boolean)
      .join(", ");
  const thumbnail =
    $("div.media div.cover img, .cover img").first().attr("data-src") ??
    $("div.media div.cover img, .cover img").first().attr("src") ??
    "";
  return {
    id,
    title: $("h1.heading, h1").first().text().trim(),
    slug: id,
    description: $(".summary > p, .summary").first().text().trim(),
    thumbnail,
    cover: thumbnail,
    status: $(".value.status").text().trim(),
    type: "manga",
    rating: 0,
    totalViews: 0,
    alternativeNames: $(".alt_name").text().trim(),
    author: value('.author a, a[href*="author"]'),
    studio: "",
    releaseYear: "",
    releaseSchedule: [],
    tags: value(".info .genres a").split(", ").filter(Boolean),
    chaptersCount: chapters.length,
    bookmarksCount: 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: "",
    chapters,
    url: `${BASE}/manga/${id}`,
    provider: "mangakatana",
    imageHeaders: HEADERS,
  };
}

export async function getMangaKatanaPages(
  seriesId: string,
  chapterSlug: string,
): Promise<ChapterData> {
  const body = await html(
    `/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterSlug)}`,
  );
  const variable = body.match(/data-src["']\s*,\s*(\w+)/)?.[1];
  const array = variable
    ? body.match(
        new RegExp(
          `(?:var|let|const)\\s+${variable}\\s*=\\s*\\[([\\s\\S]*?)\\]`,
        ),
      )?.[1]
    : undefined;
  const images = [...(array ?? "").matchAll(/["'](https?:\/\/[^"']+)["']/g)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url));
  return {
    id: chapterSlug,
    name: chapterSlug,
    title: null,
    slug: chapterSlug,
    index: chapterSlug.match(/[\d.]+/)?.[0] ?? "",
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

export const mangakatanaProvider = {
  id: "mangakatana" as const,
  search: searchMangaKatana,
  getSeries: getMangaKatanaSeries,
  getPages: getMangaKatanaPages,
};
