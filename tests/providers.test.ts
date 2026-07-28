import { listBooruSites, parseTagString } from "@yomi/hentai-core";
import { describe, expect, it } from "vitest";

describe("AniKoto provider", () => {
  it("exports search helper", async () => {
    const { anikotoProvider } = await import("@yomi/anime-core");
    expect(typeof anikotoProvider.search).toBe("function");
    expect(typeof anikotoProvider.getTrending).toBe("function");
    expect(typeof anikotoProvider.getPopular).toBe("function");
    expect(typeof anikotoProvider.getSchedule).toBe("function");
  });

  it("parses trending items from homepage HTML", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        '<div id="recent-update"><div class="item"><a class="name d-title" href="/watch/one-piece" data-jp="ワンピース">One Piece</a><div class="poster"><img src="poster.jpg" /></div><div class="ep-status sub"><span>1100</span></div><div class="ep-status dub"><span>500</span></div><div class="ep-status total"><span>1100</span></div><div class="meta"><div class="inner"><div class="right">TV</div></div></div></div></div>',
        { status: 200, headers: { "content-type": "text/html" } },
      )) as unknown as typeof fetch;

    try {
      const { getAnikotoTrending } = await import(
        "../packages/anime-core/src/providers/anikoto/index.js"
      );
      const results = await getAnikotoTrending();
      expect(results[0]?.slug).toBe("one-piece");
      expect(results[0]?.title).toBe("One Piece");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves supported player embeds to direct HLS", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example.test/master.m3u8") {
        return new Response(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8",
          {
            status: 200,
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          },
        );
      }
      if (url.includes("/stream/getSources?id=123")) {
        return Response.json({
          sources: { file: "https://cdn.example.test/master.m3u8" },
          tracks: [
            {
              file: "https://cdn.example.test/en.vtt",
              label: "English",
              kind: "captions",
            },
          ],
          intro: { start: 10, end: 20 },
          outro: { start: 100, end: 110 },
        });
      }
      return new Response('<div id="megaplay-player" data-id="123"></div>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    try {
      const { resolvePlayerSource } = await import(
        "../packages/anime-core/src/providers/anikoto/index.js"
      );
      const result = await resolvePlayerSource(
        "https://megaplay.buzz/stream/s-2/1/sub",
      );
      expect(result?.url).toBe("https://cdn.example.test/master.m3u8");
      expect(result?.format).toBe("hls");
      expect(result?.headers.Referer).toBe("https://megaplay.buzz/");
      expect(result?.tracks).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects unknown player hosts", async () => {
    const { resolvePlayerSource } = await import(
      "../packages/anime-core/src/providers/anikoto/index.js"
    );
    await expect(
      resolvePlayerSource("https://example.com/embed/123"),
    ).resolves.toBeNull();
  });
});

describe("AniPub provider", () => {
  it("normalizes search and builds safe episode IDs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search/naruto")) {
        return Response.json([
          {
            Name: "Naruto",
            Id: 82,
            Image: "https://cdn.example.test/naruto.jpg",
            finder: "naruto",
          },
        ]);
      }
      if (url.includes("/v1/api/details/82")) {
        return Response.json({
          local: {
            _id: 82,
            name: "Naruto",
            link: "src=https://anipub.xyz/video/12352/dub",
            ep: [{ link: "src=https://www.anipub.xyz/video/12353/dub" }],
          },
        });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { anipubProvider, decodeAniPubEpisodeUrl } = await import(
        "../packages/anime-core/src/providers/anipub/index.js"
      );
      const search = await anipubProvider.search("naruto");
      expect(search.results[0]).toMatchObject({
        id: "82",
        title: "Naruto",
        provider: "anipub",
      });
      const catalog = await anipubProvider.getEpisodes("82");
      expect(catalog.episodes).toHaveLength(2);
      expect(catalog.episodes[0]?.category).toBe("dub");
      expect(
        decodeAniPubEpisodeUrl(catalog.episodes[1]?.id ?? "").hostname,
      ).toBe("www.anipub.xyz");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves AniPub wrappers to direct HLS", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://anipub.xyz/video/12353/dub") {
        return new Response(
          '<iframe src="https://megaplay.buzz/stream/s-2/12353/dub"></iframe>',
          { status: 200 },
        );
      }
      if (url === "https://megaplay.buzz/stream/s-2/12353/dub") {
        return new Response('<div id="megaplay-player" data-id="12353"></div>');
      }
      if (url.includes("/stream/getSources?id=12353")) {
        return Response.json({
          sources: { file: "https://cdn.example.test/master.m3u8" },
          tracks: [],
        });
      }
      if (url === "https://cdn.example.test/master.m3u8") {
        return new Response("#EXTM3U\n#EXT-X-ENDLIST", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { anipubProvider, encodeAniPubEpisodeUrl } = await import(
        "../packages/anime-core/src/providers/anipub/index.js"
      );
      const result = await anipubProvider.getSources(
        encodeAniPubEpisodeUrl("https://anipub.xyz/video/12353/dub"),
      );
      expect(result.streams[0]?.url).toBe(
        "https://cdn.example.test/master.m3u8",
      );
      expect(result.streams[0]?.format).toBe("hls");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AnimeThemes provider", () => {
  it("normalizes search and official theme videos", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search?q=naruto")) {
        return Response.json({
          search: {
            anime: [{ id: 2028, name: "Naruto", slug: "naruto", year: 2002 }],
          },
        });
      }
      if (url.includes("/anime/naruto?include=")) {
        return Response.json({
          anime: {
            id: 2028,
            name: "Naruto",
            slug: "naruto",
            year: 2002,
            animethemes: [
              {
                id: 1476,
                type: "OP",
                sequence: 1,
                slug: "OP1",
                animethemeentries: [
                  {
                    id: 1632,
                    episodes: "1-25",
                    nsfw: false,
                    spoiler: false,
                    version: 1,
                    videos: [
                      {
                        id: 356,
                        link: "https://v.animethemes.moe/Naruto-OP1.webm",
                        resolution: 576,
                        source: "DVD",
                        nc: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { animethemesProvider } = await import(
        "../packages/anime-core/src/providers/animethemes/index.js"
      );
      const search = await animethemesProvider.search("naruto");
      expect(search.results[0]).toMatchObject({
        id: "naruto",
        provider: "animethemes",
      });
      const media = await animethemesProvider.getThemes("naruto");
      expect(media.themes[0]).toMatchObject({
        type: "OP",
        episodes: "1-25",
        isNsfw: false,
        video: {
          url: "https://v.animethemes.moe/Naruto-OP1.webm",
          creditless: true,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Booru sites", () => {
  it("lists each upstream once while preserving aliases", () => {
    const sites = listBooruSites();
    expect(sites).toHaveLength(15);
    expect(new Set(sites.map((site) => site.id)).size).toBe(sites.length);
    expect(
      sites.find((site) => site.id === "danbooru.donmai.us")?.aliases,
    ).toContain("danbooru");
  });
});

describe("OmegaScans provider", () => {
  it("filters the full catalog locally because upstream ignores q", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return Response.json({
        meta: { total: 3 },
        data: [
          { id: 1, series_slug: "one-piece", title: "One Piece" },
          { id: 2, series_slug: "sex-stopwatch", title: "Sex Stopwatch" },
          {
            id: 3,
            series_slug: "one-piece-reborn",
            title: "Reborn",
            alternative_names: "One Piece Reborn",
          },
        ],
      });
    }) as unknown as typeof fetch;

    try {
      const { searchOmega } = await import(
        "../packages/manga-core/src/providers/omegascans/index.js"
      );
      const result = await searchOmega("one piece");
      expect(capturedUrl).toContain("perPage=1000");
      expect(capturedUrl).not.toContain("q=");
      expect(result.results.map((item) => item.id)).toEqual([
        "one-piece",
        "one-piece-reborn",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("MangaFire provider", () => {
  it("signs the current API and maps search results", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return Response.json({
        items: [
          {
            hid: "dkw",
            slug: "one-piece",
            title: "One Piece",
            poster: { large: "https://cdn.example.test/one-piece.jpg" },
          },
        ],
        meta: { hasNext: false },
      });
    }) as unknown as typeof fetch;

    try {
      const { searchMangaFire } = await import(
        "../packages/manga-core/src/providers/mangafire/index.js"
      );
      const result = await searchMangaFire("one piece");
      const url = new URL(capturedUrl);
      expect(url.origin).toBe("https://mangafire.to");
      expect(url.pathname).toBe("/api/titles");
      expect(url.searchParams.get("keyword")).toBe("one piece");
      expect(url.searchParams.get("vrf")?.length).toBeGreaterThan(20);
      expect(result.results[0]).toMatchObject({
        id: "dkw",
        title: "One Piece",
        provider: "mangafire",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Tag parsing edge cases", () => {
  it("handles rating tags", () => {
    const tags = parseTagString("1girl rating:safe -furry");
    expect(tags.some((t) => t.name === "rating:safe")).toBe(true);
    expect(tags.find((t) => t.name === "furry")?.modifier).toBe("-");
  });
});

describe("Jikan + Kitsu metadata clients", () => {
  it("builds jikan anime search URL", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [],
          pagination: {
            current_page: 1,
            has_next_page: false,
            items: { total: 0, per_page: 20 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const { searchJikanAnime } = await import(
        "../packages/shared/src/metadata/jikan.js"
      );
      await searchJikanAnime("bleach", 2, 10);
      expect(capturedUrl).toContain("api.jikan.moe/v4/anime");
      expect(capturedUrl).toContain("q=bleach");
      expect(capturedUrl).toContain("page=2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes kitsu anime resources", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "1",
              type: "anime",
              attributes: { canonicalTitle: "Bleach", episodeCount: 366 },
            },
          ],
          meta: { count: 1 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/vnd.api+json" },
        },
      )) as unknown as typeof fetch;

    try {
      const { searchKitsuAnime } = await import(
        "../packages/shared/src/metadata/kitsu.js"
      );
      const result = await searchKitsuAnime("bleach");
      expect(result.results[0]?.canonicalTitle).toBe("Bleach");
      expect(result.results[0]?.id).toBe("1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
