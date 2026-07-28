import { ProviderError } from "@yomi/shared";
import type {
  Chapter,
  ChapterData,
  MangaSearchPage,
  MangaSearchResult,
  Series,
} from "../../types.js";

const MANGAFIRE_BASE = "https://mangafire.to";
const IMAGE_HEADERS = { Referer: `${MANGAFIRE_BASE}/` };

const SIGNING_STAGES = [
  {
    table:
      "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
    key: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
    iv: 0x5a,
  },
  {
    table:
      "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
    key: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
    iv: 0x35,
  },
  {
    table:
      "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==",
    key: "DELOJgPsVaCcblDtTGMdHzM=",
    iv: 0xba,
  },
] as const;

type MangaFireList<T> = {
  items: T[];
  meta?: { lastPage?: number; hasNext?: boolean };
};

type MangaFirePoster = { small?: string; medium?: string; large?: string };

type MangaFireTitle = {
  hid: string;
  slug?: string;
  title: string;
  poster?: MangaFirePoster;
};

type MangaFireDetails = MangaFireTitle & {
  type?: string;
  status?: string;
  synopsisHtml?: string;
  authors?: Array<{ title: string }>;
  artists?: Array<{ title: string }>;
  genres?: Array<{ title: string }>;
  themes?: Array<{ title: string }>;
};

type MangaFireChapter = {
  id: number;
  number: number;
  name?: string;
  createdAt?: number;
  type?: string;
};

function signMangaFirePath(path: string): string {
  let data = Buffer.from(path, "utf8");

  for (const stage of SIGNING_STAGES) {
    const table = Buffer.from(stage.table, "base64");
    const key = Buffer.from(stage.key, "base64");
    const output = Buffer.alloc(data.length);
    let previous: number = stage.iv;

    for (let index = 0; index < data.length; index++) {
      const inputByte = data[index] ?? 0;
      const keyByte = key[index % key.length] ?? 0;
      previous = table[(inputByte ^ keyByte ^ previous) & 0xff] ?? 0;
      output[index] = previous;
    }
    data = output;
  }

  return data.toString("base64url");
}

function createSignedUrl(path: string, values: Record<string, string>): URL {
  const entries = Object.entries(values).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const signaturePath = `${path.replace(/^\/api/, "")}${
    entries.length > 0
      ? `?${entries.map(([key, value]) => `${key}=${value}`).join("&")}`
      : ""
  }`;
  const url = new URL(path, MANGAFIRE_BASE);
  for (const [key, value] of entries) url.searchParams.append(key, value);
  url.searchParams.set("vrf", signMangaFirePath(signaturePath));
  return url;
}

async function fetchMangaFire<T>(
  path: string,
  values: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(createSignedUrl(path, values), {
    headers: {
      Accept: "application/json",
      Referer: `${MANGAFIRE_BASE}/`,
      "User-Agent": "YomiCore/1.0",
    },
  });
  if (!response.ok) {
    throw new ProviderError(`MangaFire API error: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function posterUrl(poster?: MangaFirePoster): string {
  return poster?.large ?? poster?.medium ?? poster?.small ?? "";
}

function chapterDate(timestamp?: number): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toISOString();
}

function toChapter(chapter: MangaFireChapter, seriesId: string): Chapter {
  const number = String(chapter.number).replace(/\.0$/, "");
  return {
    id: chapter.id,
    name: `Ch. ${number}`,
    title: chapter.name ?? null,
    slug: String(chapter.id),
    thumbnail: "",
    price: 0,
    isFree: true,
    createdAt: chapterDate(chapter.createdAt),
    index: number,
    url: `/v1/manga/mangafire/pages/${seriesId}/${chapter.id}`,
  };
}

async function getMangaFireChapters(seriesId: string): Promise<Chapter[]> {
  const first = await fetchMangaFire<MangaFireList<MangaFireChapter>>(
    `/api/titles/${seriesId}/chapters`,
    {
      language: "en",
      limit: "200",
      order: "desc",
      page: "1",
      sort: "number",
    },
  );
  const lastPage = first.meta?.lastPage ?? 1;
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) =>
      fetchMangaFire<MangaFireList<MangaFireChapter>>(
        `/api/titles/${seriesId}/chapters`,
        {
          language: "en",
          limit: "200",
          order: "desc",
          page: String(index + 2),
          sort: "number",
        },
      ),
    ),
  );
  return [first, ...remaining].flatMap((page) =>
    page.items.map((chapter) => toChapter(chapter, seriesId)),
  );
}

export async function searchMangaFire(
  query: string,
  page = 1,
): Promise<MangaSearchPage> {
  const perPage = 50;
  const data = await fetchMangaFire<MangaFireList<MangaFireTitle>>(
    "/api/titles",
    { keyword: query, limit: String(perPage), page: String(page) },
  );
  return {
    results: data.items.map(
      (title): MangaSearchResult => ({
        id: title.hid,
        title: title.title,
        image: posterUrl(title.poster),
        provider: "mangafire",
        imageHeaders: IMAGE_HEADERS,
      }),
    ),
    pagination: {
      page,
      perPage,
      total: data.items.length,
      hasNextPage: data.meta?.hasNext ?? false,
    },
  };
}

export async function getMangaFireSeries(
  id: string,
  includeChapters = false,
): Promise<Series> {
  const { data } = await fetchMangaFire<{ data: MangaFireDetails }>(
    `/api/titles/${id}`,
  );
  const chapters = includeChapters ? await getMangaFireChapters(id) : [];
  const thumbnail = posterUrl(data.poster);
  return {
    id: data.hid,
    title: data.title,
    slug: data.hid,
    description: String(data.synopsisHtml ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    thumbnail,
    cover: thumbnail,
    status: data.status ?? "",
    type: data.type ?? "manga",
    rating: 0,
    totalViews: 0,
    alternativeNames: "",
    author: data.authors?.map(({ title }) => title).join(", ") ?? "",
    studio: data.artists?.map(({ title }) => title).join(", ") ?? "",
    releaseYear: "",
    releaseSchedule: [],
    tags: [...(data.genres ?? []), ...(data.themes ?? [])].map(
      ({ title }) => title,
    ),
    chaptersCount: chapters.length,
    bookmarksCount: 0,
    isComingSoon: false,
    badge: null,
    createdAt: "",
    updatedAt: "",
    chapters,
    url: `/v1/manga/mangafire/series/${data.hid}`,
    provider: "mangafire",
    imageHeaders: IMAGE_HEADERS,
  };
}

export async function getMangaFirePages(
  seriesId: string,
  chapterId: string,
): Promise<ChapterData> {
  const { data } = await fetchMangaFire<{
    data: { pages?: Array<{ url: string }> };
  }>(`/api/chapters/${chapterId}`);
  const images = (data.pages ?? []).map(({ url }) => url);
  return {
    id: chapterId,
    name: "",
    title: null,
    slug: chapterId,
    index: "",
    price: 0,
    isFree: true,
    thumbnail: "",
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

export const mangafireProvider = {
  id: "mangafire" as const,
  search: searchMangaFire,
  getSeries: getMangaFireSeries,
  getPages: getMangaFirePages,
};
