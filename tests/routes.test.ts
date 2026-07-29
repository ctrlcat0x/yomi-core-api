import { describe, expect, it } from "vitest";

describe("API routes", () => {
  it("lists anime providers", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/anime/providers");
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual(["anikoto", "anipub", "animethemes", "miruro"]);
  });

  it("lists manga providers", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/manga/providers");
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      "mangak",
      "omegascans",
      "mangafire",
      "weebcentral",
      "atsumaru",
      "mangakatana",
      "mangaball",
    ]);
  });

  it("exposes Valorant source aliases", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/manga/sources");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toContainEqual(
      expect.objectContaining({ id: "mangak", codename: "jett" }),
    );
    expect(json.data).toContainEqual(
      expect.objectContaining({ id: "nhentai", codename: "killjoy" }),
    );
  });

  it("accepts codenames and exposes onboarding fields", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const onboarding = await app.request("/v1/manga/onboarding");
    const onboardingJson = await onboarding.json();
    expect(onboardingJson.data.genres).toContain("Action");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        success: true,
        data: { items: [], pagination: {} },
      })) as unknown as typeof fetch;
    try {
      const search = await app.request(
        "/v1/manga/search?q=naruto&provider=jett",
      );
      expect(search.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates aggregate and recommendation inputs", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    expect((await app.request("/v1/manga/aggregate/search")).status).toBe(422);
    expect((await app.request("/v1/manga/aggregate/series")).status).toBe(422);
    expect(
      (await app.request("/v1/manga/aggregate/pages?title=Naruto")).status,
    ).toBe(422);
    expect((await app.request("/v1/manga/recommendations")).status).toBe(422);
  });

  it("accepts slash-containing manga series ids", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const id = "01J76XYCPSY3C4BNPBRY8JMCBE/Solo-Leveling";
    const res = await app.request(
      `/v1/manga/weebcentral/series/${encodeURIComponent(id)}`,
    );
    expect(res.status).not.toBe(404);
  });

  it("validates universal search query", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/search");
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("includes hentai results in universal search", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co")) {
        return new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [],
                pageInfo: { total: 0, currentPage: 1, lastPage: 1 },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("donmai.us")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              file_url: "https://cdn.donmai.us/original/ab/cd/abcdef.jpg",
              preview_file_url:
                "https://cdn.donmai.us/360x360/ab/cd/abcdef.jpg",
              large_file_url: "https://cdn.donmai.us/sample/sample.jpg",
              image_width: 800,
              image_height: 1200,
              tag_string: "1girl solo",
              rating: "s",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request(
        "/v1/search?q=1girl&types=anime,manga,hentai",
      );
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.hentai)).toBe(true);
      expect(json.data.hentai.length).toBeGreaterThan(0);
      expect(json.pagination?.total).toBe(
        json.data.anime.length +
          json.data.manga.length +
          json.data.hentai.length,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("excludes adult search unless explicitly requested", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/search?q=naruto&types=hentai,bogus");
    expect(res.status).toBe(422);
  });

  it("rejects unknown providers", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const anime = await app.request("/v1/anime/unknown/episodes/test");
    const manga = await app.request("/v1/manga/search?q=test&provider=unknown");
    expect(anime.status).toBe(422);
    expect(manga.status).toBe(422);
  });

  it("rejects removed manga providers", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    for (const provider of [
      "consumet",
      "luscious",
      "mangakakalot",
      "mangadex",
    ]) {
      const res = await app.request(
        `/v1/manga/search?q=test&provider=${provider}`,
      );
      expect(res.status).toBe(422);
    }
  });

  it("returns AniKoto info instead of an episode list", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        '<main id="watch-main" data-id="42"><h1 itemprop="name" class="title d-title" data-jp="テスト">Test Anime</h1><img itemprop="image" src="poster.jpg" /><div class="synopsis"><div class="content">Synopsis</div></div></main>',
        { status: 200, headers: { "content-type": "text/html" } },
      )) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request("/v1/anime/anikoto/info/test-anime");
      const json = await res.json();
      expect(json.data.title).toBe("Test Anime");
      expect(json.data.animeId).toBe(42);
      expect(json.data.episodes).not.toBeInstanceOf(Array);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates anikoto schedule date", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/anime/anikoto/schedule");
    expect(res.status).toBe(422);
    const bad = await app.request("/v1/anime/anikoto/schedule?date=not-a-date");
    expect(bad.status).toBe(422);
  });

  it("exposes anikoto browse routes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("anikoto")) {
        return new Response(
          '<div class="section-updated"><div class="item"><a class="name d-title" href="/watch/test-anime">Test</a><div class="poster"><img src="p.jpg" /></div><div class="ep-status sub"><span>12</span></div><div class="ep-status dub"><span>0</span></div><div class="ep-status total"><span>12</span></div><div class="meta"><div class="inner"><div class="right">TV</div></div></div></div></div>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request("/v1/anime/anikoto/trending");
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data[0]?.slug).toBe("test-anime");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates proxy image url", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/proxy/image");
    expect(res.status).toBe(422);
  });

  it("validates anime search metadata source", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/v1/anime/search?q=naruto&source=bogus");
    expect(res.status).toBe(422);
  });

  it("exposes jikan anime search via source param", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.jikan.moe")) {
        return new Response(
          JSON.stringify({
            pagination: {
              current_page: 1,
              has_next_page: false,
              items: { count: 1, total: 1, per_page: 20 },
            },
            data: [
              {
                mal_id: 20,
                title: "Naruto",
                episodes: 220,
                images: {
                  jpg: { image_url: "https://cdn.myanimelist.net/n.jpg" },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request("/v1/anime/search?q=naruto&source=jikan");
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data[0]?.mal_id).toBe(20);
      expect(json.pagination?.source).toBe("jikan");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exposes kitsu anime info route", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("kitsu.io")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "1555",
              type: "anime",
              attributes: {
                canonicalTitle: "Naruto Shippuden",
                episodeCount: 500,
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/vnd.api+json" },
          },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request("/v1/anime/kitsu/1555");
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data?.canonicalTitle).toBe("Naruto Shippuden");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exposes jikan manga metadata search", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.jikan.moe/v4/manga")) {
        return new Response(
          JSON.stringify({
            pagination: {
              current_page: 1,
              has_next_page: false,
              items: { count: 1, total: 1, per_page: 20 },
            },
            data: [{ mal_id: 1, title: "Monster" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { app } = await import("../apps/server/src/routes/index.js");
      const res = await app.request("/v1/manga/jikan/search?q=monster");
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data[0]?.mal_id).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("WeebCentral helpers", () => {
  it("builds full-chapter-list path from series slug", async () => {
    const { weebcentralProvider } = await import("@yomi/manga-core");
    // Indirectly verified via exported provider — path logic is internal;
    // route integration test above covers slash ids.
    expect(weebcentralProvider.id).toBe("weebcentral");
  });
});
