import { ProviderError, TTL, cached, config } from "../../../../shared/src";

const BASE_URL = "https://nhentai.net";

type Gallery = {
  id: number;
  media_id: string;
  english_title: string;
  japanese_title: string;
  thumbnail: string;
  thumbnail_width: number;
  thumbnail_height: number;
  num_pages: number;
  num_favorites: number;
  tag_ids: number[];
  blacklisted: boolean;
};

type SearchResponse = {
  result: Gallery[];
  num_pages: number;
  per_page: number;
  total: number;
};

export async function doujinshiSearch(query: string, page = 1) {
  return cached(`doujinshi_${query}_${page}`, TTL.search, async () => {
    const url = new URL("/api/v2/search", BASE_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new ProviderError(
        `Doujinshi API HTTP ${response.status}`,
        response.status === 429 ? 429 : 502,
      );
    const data = (await response.json()) as SearchResponse;
    return {
      page,
      perPage: data.per_page,
      total: data.total,
      hasNextPage: page < data.num_pages,
      results: (data.result ?? [])
        .filter((gallery) => !gallery.blacklisted)
        .map((gallery) => ({
          id: String(gallery.id),
          mediaId: gallery.media_id,
          title: gallery.english_title || gallery.japanese_title,
          japaneseTitle: gallery.japanese_title || null,
          thumbnail: `https://t1.nhentai.net/${gallery.thumbnail}`,
          width: gallery.thumbnail_width,
          height: gallery.thumbnail_height,
          pages: gallery.num_pages,
          favorites: gallery.num_favorites,
          tagIds: gallery.tag_ids,
          provider: "nhentai",
          codename: "killjoy",
        })),
      source: "nhentai",
      codename: "killjoy",
    };
  });
}
