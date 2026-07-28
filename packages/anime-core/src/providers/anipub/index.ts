import { Buffer } from "node:buffer";
import { ProviderError, config } from "@yomi/shared";
import * as cheerio from "cheerio";
import { resolvePlayerSource } from "../anikoto/index.js";

const BASE_URL = "https://anipub.xyz";
const ALLOWED_EPISODE_HOSTS = new Set([
  "anipub.xyz",
  "www.anipub.xyz",
  "gogoanime.com.by",
]);

export const ANIPUB_PROVENANCE = {
  name: "anipub",
  tier: "C",
  kind: "community-api",
  canonical: false,
} as const;

type AniPubSearchItem = {
  Name?: string;
  Id?: number | string;
  Image?: string;
  finder?: string;
};

type AniPubInfo = {
  _id?: number | string;
  Name?: string;
  ImagePath?: string;
  Cover?: string;
  Synonyms?: string;
  Aired?: string;
  Premiered?: string;
  Duration?: string;
  Status?: string;
  MALScore?: string | number;
  Genres?: string[];
  Studios?: string;
  Producers?: string;
  DescripTion?: string;
  epCount?: number;
};

type AniPubEpisodeLink = { link?: string };
type AniPubDetails = {
  local?: {
    _id?: number | string;
    name?: string;
    finder?: string;
    link?: string;
    type?: string;
    ep?: AniPubEpisodeLink[];
  };
};

function absoluteImage(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, `${BASE_URL}/`).toString();
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": config.userAgent,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new ProviderError(`AniPub HTTP ${response.status}: ${path}`);
  }
  return (await response.json()) as T;
}

function normalizeSearchItem(item: AniPubSearchItem) {
  const id = String(item.Id ?? item.finder ?? "");
  return {
    id,
    slug: item.finder ?? id,
    title: item.Name ?? "Unknown",
    image: absoluteImage(item.Image),
    provider: "anipub" as const,
    sourceIds: { anipub: id },
    provenance: ANIPUB_PROVENANCE,
  };
}

export async function searchAniPub(query: string, page = 1, perPage = 20) {
  const items = await fetchJson<AniPubSearchItem[]>(
    `/api/search/${encodeURIComponent(query)}`,
  );
  const normalized = Array.isArray(items)
    ? items.map(normalizeSearchItem).filter((item) => item.id)
    : [];
  const offset = (page - 1) * perPage;
  return {
    page,
    perPage,
    total: normalized.length,
    hasNextPage: offset + perPage < normalized.length,
    results: normalized.slice(offset, offset + perPage),
    source: "anipub" as const,
  };
}

export async function getAniPubInfo(id: string) {
  const info = await fetchJson<AniPubInfo>(
    `/api/info/${encodeURIComponent(id)}`,
  );
  const sourceId = String(info._id ?? id);
  return {
    id: sourceId,
    slug: id,
    title: info.Name ?? "Unknown",
    synonyms: info.Synonyms
      ? info.Synonyms.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    description: info.DescripTion ?? "",
    thumbnail: absoluteImage(info.ImagePath),
    cover: absoluteImage(info.Cover),
    aired: info.Aired ?? null,
    premiered: info.Premiered ?? null,
    duration: info.Duration ?? null,
    status: info.Status ?? null,
    score: Number(info.MALScore) || null,
    genres: Array.isArray(info.Genres) ? info.Genres : [],
    studios: info.Studios ? [info.Studios] : [],
    producers: info.Producers
      ? info.Producers.split(",").map((v) => v.trim())
      : [],
    totalEpisodes: info.epCount ?? 0,
    provider: "anipub" as const,
    sourceIds: { anipub: sourceId },
    provenance: ANIPUB_PROVENANCE,
  };
}

function sourceUrlFromLink(link?: string): string | null {
  const raw = link?.replace(/^src=/, "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !ALLOWED_EPISODE_HOSTS.has(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function encodeAniPubEpisodeUrl(url: string): string {
  return Buffer.from(url, "utf8").toString("base64url");
}

export function decodeAniPubEpisodeUrl(value: string): URL {
  let url: URL;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    url = new URL(decoded);
  } catch {
    throw new ProviderError("Invalid AniPub episode ID", 422);
  }
  if (url.protocol !== "https:" || !ALLOWED_EPISODE_HOSTS.has(url.hostname)) {
    throw new ProviderError("Invalid AniPub episode source", 422);
  }
  return url;
}

function languageFromUrl(url: URL): string {
  const pathValue = url.pathname.split("/").filter(Boolean).at(-1);
  return pathValue === "dub" || pathValue === "sub"
    ? pathValue
    : (url.searchParams.get("type") ?? "unknown");
}

export async function getAniPubEpisodes(id: string) {
  const data = await fetchJson<AniPubDetails>(
    `/v1/api/details/${encodeURIComponent(id)}`,
  );
  const local = data.local;
  if (!local) throw new ProviderError("AniPub returned no episode catalog");

  const links = [
    local.link,
    ...(local.ep ?? []).map((episode) => episode.link),
  ];
  const episodes = links.flatMap((link, index) => {
    const sourceUrl = sourceUrlFromLink(link);
    if (!sourceUrl) return [];
    const url = new URL(sourceUrl);
    return [
      {
        id: encodeAniPubEpisodeUrl(sourceUrl),
        number: index + 1,
        title: `Episode ${index + 1}`,
        category: languageFromUrl(url),
        filler: false,
        provider: "anipub" as const,
        provenance: ANIPUB_PROVENANCE,
      },
    ];
  });

  return {
    animeId: String(local._id ?? id),
    slug: local.finder ?? id,
    title: local.name ?? "",
    totalEpisodes: episodes.length,
    episodes,
    provider: "anipub" as const,
    provenance: ANIPUB_PROVENANCE,
  };
}

async function resolveAniPubEmbed(wrapperUrl: URL): Promise<string | null> {
  if (!wrapperUrl.hostname.endsWith("anipub.xyz")) return wrapperUrl.toString();
  const response = await fetch(wrapperUrl, {
    headers: { "User-Agent": config.userAgent, Referer: `${BASE_URL}/` },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const $ = cheerio.load(await response.text());
  const src = $("iframe[src]").first().attr("src");
  if (!src) return null;
  try {
    const embed = new URL(src, response.url || wrapperUrl);
    return embed.protocol === "https:" ? embed.toString() : null;
  } catch {
    return null;
  }
}

export async function getAniPubSources(episodeId: string) {
  const wrapperUrl = decodeAniPubEpisodeUrl(episodeId);
  const embedUrl = await resolveAniPubEmbed(wrapperUrl);
  if (!embedUrl) throw new ProviderError("AniPub embed is unavailable");

  const resolved = await resolvePlayerSource(embedUrl);
  if (resolved) {
    return {
      streams: [
        {
          ...resolved,
          quality: "auto",
          provider: "anipub",
          provenance: ANIPUB_PROVENANCE,
        },
      ],
      embeds: [{ url: embedUrl, provider: "anipub" }],
      provider: "anipub" as const,
      provenance: ANIPUB_PROVENANCE,
    };
  }

  return {
    streams: [
      {
        url: embedUrl,
        format: "embed",
        quality: "embed",
        headers: { Referer: `${BASE_URL}/` },
        provider: "anipub",
        provenance: ANIPUB_PROVENANCE,
      },
    ],
    embeds: [{ url: embedUrl, provider: "anipub" }],
    provider: "anipub" as const,
    provenance: ANIPUB_PROVENANCE,
  };
}

export const anipubProvider = {
  id: "anipub" as const,
  search: searchAniPub,
  getInfo: getAniPubInfo,
  getEpisodes: getAniPubEpisodes,
  getSources: getAniPubSources,
};
