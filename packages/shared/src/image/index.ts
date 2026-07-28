import { ProxyError } from "../errors/index.js";
import { assertPublicHttpUrl } from "../network/index.js";

const REFERER_BY_HOST: Array<[RegExp, string]> = [
  [/donmai\.us/i, "https://danbooru.donmai.us/"],
  [/mfcdn/i, "https://mangafire.to/"],
  [/weebcentral/i, "https://weebcentral.com/"],
  [/omegascans|omegascan/i, "https://omegascans.org/"],
];

export function refererForImageUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    for (const [pattern, referer] of REFERER_BY_HOST) {
      if (pattern.test(host)) return referer;
    }
  } catch {
    /* invalid url */
  }
  return undefined;
}

export function imageHeadersForUrl(
  url: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers = headersForUrl(url, extra);
  const referer = extra?.Referer ?? refererForImageUrl(url);
  if (referer) headers.Referer = referer;
  return headers;
}

function headersForUrl(
  url: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const host = new URL(url).hostname;

  if (host.includes("donmai.us")) {
    return {
      "User-Agent": "Danbooru/2.0 (compatible; Danbooru API)",
      Accept: "image/*,*/*",
      ...extra,
    };
  }

  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "image/*,*/*",
    ...extra,
  };
}

export async function proxyImageRequest(
  url: string,
  opts: {
    width?: number;
    quality?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<{ body: ArrayBuffer; contentType: string }> {
  assertPublicHttpUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;

  try {
    res = await fetch(url, {
      headers: imageHeadersForUrl(url, opts.headers),
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new ProxyError(`Upstream returned ${res.status}`);

  const contentType =
    (res.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      ?.trim() ?? "application/octet-stream";
  const buffer = await res.arrayBuffer();

  return { body: buffer, contentType };
}

export function imageProxyHints(opts: {
  width?: number;
  quality?: number;
}): Record<string, string> {
  const hints: Record<string, string> = {};
  if (opts.width) hints["X-Yomi-Resize-Width"] = String(opts.width);
  if (opts.quality) hints["X-Yomi-Resize-Quality"] = String(opts.quality);
  return hints;
}
