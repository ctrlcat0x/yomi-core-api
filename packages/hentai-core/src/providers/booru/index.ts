import { ProviderError, TTL, cached, config } from "@yomi/shared";
import type { SearchableTag } from "@yomi/shared";
import { type Post, forSite, search, sites } from "booru";
import {
  type BlockingGroup,
  parseTagString,
  serializeSearch,
} from "../../tag/serialization.js";

export interface NormalizedPost {
  id: string;
  site: string;
  fileUrl: string;
  previewUrl: string;
  sampleUrl: string;
  width: number;
  height: number;
  tags: string[];
  rating: string;
  score?: number;
  lazyHint: "preview" | "sample" | "file";
}

export interface BooruSiteInfo {
  id: string;
  domain: string;
  aliases: string[];
  nsfw: boolean;
  requiresAuth: boolean;
  defaultTags?: string[];
}

type BooruSiteMeta = {
  domain: string;
  aliases: string[];
  nsfw: boolean;
  defaultTags?: string[];
};

const SITE_REGISTRY = sites as Record<string, BooruSiteMeta>;

const AUTH_SITES = new Set(["rule34", "r34", "gelbooru", "gb"]);

function normalizePost(post: Post, site: string): NormalizedPost {
  return {
    id: String(post.id ?? ""),
    site,
    fileUrl: post.fileUrl ?? "",
    previewUrl: post.previewUrl ?? post.fileUrl ?? "",
    sampleUrl: post.sampleUrl ?? post.fileUrl ?? "",
    width: post.width ?? 0,
    height: post.height ?? 0,
    tags: post.tags ?? [],
    rating: post.rating ?? "unknown",
    score: post.score,
    lazyHint: "preview",
  };
}

function siteCredentials(
  site: string,
): { api_key?: string; user_id?: string } | undefined {
  const alias = resolveSiteAlias(site);
  if (alias === "rule34" || alias === "r34")
    return config.booruCredentials.rule34;
  if (alias === "gelbooru" || alias === "gb")
    return config.booruCredentials.gelbooru;
  return undefined;
}

function resolveSiteAlias(site: string): string {
  const normalized = site.toLowerCase().trim();
  for (const meta of Object.values(SITE_REGISTRY)) {
    if (meta.domain.toLowerCase() === normalized) {
      return meta.aliases[0] ?? normalized;
    }
    if (meta.aliases.some((a) => a.toLowerCase() === normalized)) {
      return meta.aliases[0] ?? normalized;
    }
  }
  return normalized;
}

function buildTagQuery(opts: {
  tags?: SearchableTag[];
  q?: string;
  rating?: string;
  blocked?: BlockingGroup[];
}): string[] {
  const tags = opts.tags?.length
    ? opts.tags
    : opts.q?.trim()
      ? parseTagString(opts.q)
      : [];
  return serializeSearch(tags, { rating: opts.rating, blocked: opts.blocked });
}

function defaultTagsForSite(site: string): string[] {
  const alias = resolveSiteAlias(site);
  for (const meta of Object.values(SITE_REGISTRY)) {
    if (meta.aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
      return meta.defaultTags ?? [];
    }
  }
  return [];
}

function requireCredentials(site: string) {
  const alias = resolveSiteAlias(site);
  if (!AUTH_SITES.has(alias)) return;

  const creds = siteCredentials(site);
  if (alias === "rule34" || alias === "r34") {
    if (!creds?.api_key || !creds?.user_id) {
      throw new ProviderError(
        "rule34 requires BOORU_RULE34_API_KEY and BOORU_RULE34_USER_ID in .env",
        401,
      );
    }
    return;
  }
  if ((alias === "gelbooru" || alias === "gb") && !creds?.api_key) {
    throw new ProviderError(
      "gelbooru requires BOORU_GELBOORU_API_KEY in .env",
      401,
    );
  }
}

function normalizeSearchResults(results: unknown): Post[] {
  if (typeof results === "string") {
    throw new ProviderError(results, 502);
  }
  if (Array.isArray(results)) return results;
  if (results && typeof results === "object" && Symbol.iterator in results) {
    return [...(results as Iterable<Post>)];
  }
  throw new ProviderError("Unexpected booru response", 502);
}

export async function hentaiSearch(opts: {
  site?: string;
  tags?: SearchableTag[];
  q?: string;
  page?: number;
  limit?: number;
  random?: boolean;
  rating?: string;
  blocked?: BlockingGroup[];
}) {
  const site = opts.site ?? "danbooru";
  const tagQuery = [
    ...defaultTagsForSite(site),
    ...buildTagQuery({
      tags: opts.tags,
      q: opts.q,
      rating: opts.rating,
      blocked: opts.blocked,
    }),
  ].filter(Boolean);

  requireCredentials(site);

  const key = `hentai_${site}_${tagQuery.join("_")}_${opts.page ?? 0}_${opts.limit ?? 20}_${opts.random ?? false}`;
  return cached(key, TTL.booru, async () => {
    const credentials = siteCredentials(site);
    const results = await search(site, tagQuery, {
      limit: opts.limit ?? 20,
      page: opts.page ?? 0,
      random: opts.random,
      credentials: credentials as Record<string, string> | undefined,
    });

    const posts = normalizeSearchResults(results);

    return {
      posts: posts
        .filter((post): post is Post =>
          Boolean(post && typeof post === "object"),
        )
        .map((post) => normalizePost(post, site)),
      site,
      tagQuery,
    };
  });
}

export async function imageboardSearch(opts: {
  q: string;
  page?: number;
  limit?: number;
  rating?: string;
  blocked?: BlockingGroup[];
}) {
  const sourceLimit = Math.max(1, Math.min(opts.limit ?? 5, 20));
  const siteList = listBooruSites();
  const results: Array<Awaited<ReturnType<typeof hentaiSearch>> | null> = [];
  const statuses: Array<Record<string, unknown>> = [];

  for (let offset = 0; offset < siteList.length; offset += 4) {
    const batch = siteList.slice(offset, offset + 4);
    const settled = await Promise.allSettled(
      batch.map((site) =>
        hentaiSearch({
          site: site.aliases[0] ?? site.id,
          q: opts.q,
          page: opts.page,
          limit: sourceLimit,
          rating: opts.rating,
          blocked: opts.blocked,
        }),
      ),
    );
    settled.forEach((result, index) => {
      const site = batch[index];
      if (!site) return;
      if (result.status === "fulfilled") {
        results.push(result.value);
        statuses.push({
          site: site.id,
          status: "fulfilled",
          count: result.value.posts.length,
        });
      } else {
        results.push(null);
        statuses.push({
          site: site.id,
          status: "rejected",
          count: 0,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });
  }

  const deduped = new Map<string, NormalizedPost>();
  for (const result of results) {
    for (const post of result?.posts ?? []) {
      const key = post.fileUrl || `${post.site}:${post.id}`;
      if (!deduped.has(key)) deduped.set(key, post);
    }
  }
  return {
    posts: [...deduped.values()],
    sources: statuses,
    totalSources: siteList.length,
    successfulSources: statuses.filter(({ status }) => status === "fulfilled")
      .length,
  };
}

export function listBooruSites(): BooruSiteInfo[] {
  return Object.entries(SITE_REGISTRY)
    .map(([id, meta]) => ({
      id,
      domain: meta.domain,
      aliases: meta.aliases,
      nsfw: meta.nsfw,
      requiresAuth: AUTH_SITES.has(resolveSiteAlias(id)),
      defaultTags: meta.defaultTags,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const booruProvider = {
  id: "booru" as const,
  search: hentaiSearch,
  sites: listBooruSites,
  forSite,
};

export * from "../../tag/serialization.js";
