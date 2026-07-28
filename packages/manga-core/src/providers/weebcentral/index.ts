import * as cheerio from "cheerio";
import type {
  Chapter,
  ChapterData,
  MangaSearchResult,
  Series,
} from "../../types.js";

const BASE = "https://weebcentral.com";

// WeebCentral blocks known browser UAs — rotate with realistic Chrome on Linux
const USER_AGENTS = [
  "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return (
    USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
  );
}

function getHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": randomUA(),
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Connection: "keep-alive",
    ...extra,
  };
}

async function fetchHtml(
  url: string,
  extra?: Record<string, string>,
): Promise<string> {
  const res = await fetch(url, {
    headers: getHeaders(extra),
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`WeebCentral HTTP ${res.status}: ${url}`);
  return res.text();
}

export async function searchWeebcentral(
  query: string,
  page = 1,
): Promise<{ results: MangaSearchResult[]; hasNextPage: boolean }> {
  const limit = 32;
  const offset = (page - 1) * limit;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    text: query,
    sort: "Best Match",
    display_mode: "Full Display",
  });

  const res = await fetch(`${BASE}/search/data?${params}`, {
    headers: {
      ...getHeaders(),
      Accept: "text/html, */*",
      "HX-Request": "true",
    },
  });
  if (!res.ok) throw new Error(`WeebCentral search HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: MangaSearchResult[] = [];

  // Reference: span.tooltip.tooltip-bottom > a[href] + data-tip title
  $("span.tooltip.tooltip-bottom").each((_, el) => {
    const a = $(el).find("a");
    const url = a.attr("href") ?? "";
    const title = $(el).attr("data-tip") ?? a.text().trim();
    const image = $(el).find("img").attr("src") ?? "";
    if (url && title) {
      const id = url.replace(/\/$/, "").split("/").slice(-2).join("/");
      results.push({ id, title, image, provider: "weebcentral" });
    }
  });

  // Fallback — simpler article/a structure
  if (!results.length) {
    $("article a").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const title = $(el).attr("data-tip") ?? $(el).text().trim();
      const image = $(el).find("img").attr("src") ?? "";
      if (href && title) {
        const id = href.replace(/\/$/, "").split("/").slice(-2).join("/");
        results.push({ id, title, image, provider: "weebcentral" });
      }
    });
  }

  return { results, hasNextPage: results.length === limit };
}

function fullChapterListPath(seriesPath: string): string {
  // Reference (Weeb-dl): pop slug segment → /series/{id}/full-chapter-list
  const parts = seriesPath.replace(/\/$/, "").split("/");
  if (parts.length >= 2) parts.pop();
  parts.push("full-chapter-list");
  return parts.join("/");
}

export async function getWeebcentralSeries(
  id: string,
  includeChapters = true,
): Promise<Series> {
  // id format: "series/slug" or bare slug
  const urlPath = id.startsWith("series/") ? id : `series/${id}`;
  const html = await fetchHtml(`${BASE}/${urlPath}`);
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $("title").text().replace("- WeebCentral", "").trim();
  const image =
    $('img[alt*="cover" i]').first().attr("src") ??
    $("picture img[src*='cover/']").first().attr("src") ??
    "";
  const description = $("p.text-sm, section p").first().text().trim();
  const status = $("li")
    .filter((_, el) => $(el).text().includes("Status"))
    .find("span")
    .last()
    .text()
    .trim();
  const author = $("li")
    .filter((_, el) => $(el).text().includes("Author"))
    .find("a")
    .first()
    .text()
    .trim();
  const tags: string[] = [];
  $("ul.flex.flex-wrap a, .genres a").each((_, el) => {
    const t = $(el).text().trim();
    if (t) tags.push(t);
  });

  const chapters: Chapter[] = [];

  if (includeChapters) {
    try {
      const chHtml = await fetchHtml(`${BASE}/${fullChapterListPath(urlPath)}`);
      const $ch = cheerio.load(chHtml);

      const titleEls = $ch("span.grow.flex.items-center.gap-2")
        .toArray()
        .reverse();
      const linkEls = $ch("div.flex.items-center").toArray().reverse();

      titleEls.forEach((el, i) => {
        const linkEl = linkEls[i];
        const chapterUrl = $ch(linkEl).find("a").first().attr("href") ?? "";
        const chapterSlug =
          chapterUrl.replace(/\/$/, "").split("/").pop() ?? String(i + 1);
        const name =
          $ch(el).find("span").first().text().trim() ||
          $ch(el).text().trim() ||
          `Chapter ${i + 1}`;

        chapters.push({
          id: chapterSlug,
          name,
          title: null,
          slug: chapterSlug,
          thumbnail: "",
          price: 0,
          isFree: true,
          createdAt: "",
          index: String(i + 1),
          url: `/v1/manga/weebcentral/pages/${encodeURIComponent(chapterSlug)}`,
        });
      });
    } catch {
      // Chapter list fetch failed — series still returned without chapters
    }
  }

  return {
    id,
    title,
    slug: id,
    description,
    thumbnail: image,
    cover: image,
    status,
    type: "manga",
    rating: 0,
    totalViews: 0,
    alternativeNames: "",
    author,
    studio: "",
    releaseYear: "",
    releaseSchedule: [],
    tags,
    chaptersCount: chapters.length,
    bookmarksCount: 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: "",
    chapters,
    url: `${BASE}/${urlPath}`,
    provider: "weebcentral",
  };
}

export async function getWeebcentralPages(
  chapterId: string,
): Promise<ChapterData> {
  // chapterId may be bare slug or full path like "chapters/abc"
  const urlPath = chapterId.startsWith("chapters/")
    ? chapterId
    : `chapters/${chapterId}`;
  const html = await fetchHtml(
    `${BASE}/${urlPath}/images?is_prev=False&reading_style=long_strip`,
    { Accept: "text/html, */*", "HX-Request": "true" },
  );
  const $ = cheerio.load(html);
  const images: string[] = [];

  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (src && !src.includes("data:")) images.push(src);
  });

  return {
    id: chapterId,
    name: chapterId,
    title: null,
    slug: chapterId,
    index: "1",
    price: 0,
    isFree: true,
    thumbnail: images[0] ?? "",
    images,
    pageCount: images.length,
    createdAt: "",
    headerForImage: { Referer: `${BASE}/` },
    series: {
      id: chapterId,
      title: "",
      slug: "",
      thumbnail: "",
      status: "",
      description: "",
    },
  };
}

export const weebcentralProvider = {
  id: "weebcentral" as const,
  search: (q: string, page?: number) => searchWeebcentral(q, page),
  getSeries: (id: string, includeChapters?: boolean) =>
    getWeebcentralSeries(id, includeChapters),
  getPages: getWeebcentralPages,
};
