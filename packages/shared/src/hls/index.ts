import { assertPublicHttpUrl } from "../network/index.js";

export function proxyHref(target: string, basePath = "/v1/proxy/hls"): string {
  return `${basePath}?url=${encodeURIComponent(target)}`;
}

export function urlJoin(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

export function isM3u8(
  url: string,
  contentType: string,
  body: Uint8Array,
): boolean {
  try {
    if (new URL(url).pathname.toLowerCase().endsWith(".m3u8")) return true;
  } catch {
    /* ignore */
  }
  const ct = contentType.toLowerCase();
  if (ct.includes("mpegurl") || ct.includes("m3u8")) return true;
  const head = new TextDecoder().decode(body.subarray(0, 32)).trimStart();
  return head.startsWith("#EXTM3U");
}

export function rewriteM3u8(
  content: string,
  baseUrl: string,
  proxyBase = "/v1/proxy/hls",
): string {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      if (line.includes('URI="')) {
        out.push(
          line.replace(/URI="([^"]+)"/g, (_, uri: string) => {
            return `URI="${proxyHref(urlJoin(baseUrl, uri), proxyBase)}"`;
          }),
        );
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(proxyHref(urlJoin(baseUrl, line.trim()), proxyBase));
  }
  return `${out.join("\n")}\n`;
}

export async function fetchUpstream(
  url: string,
  opts: {
    headers?: Record<string, string>;
    range?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.range) headers.Range = opts.range;

  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyHlsRequest(
  url: string,
  headers: Record<string, string>,
  range?: string | null,
): Promise<{
  body: string | ArrayBuffer;
  contentType: string;
  status: number;
  extraHeaders?: Record<string, string>;
}> {
  const res = await fetchUpstream(url, { headers, range });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);

  const contentType =
    (res.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      ?.trim() ?? "application/octet-stream";
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (isM3u8(url, contentType, bytes)) {
    return {
      body: rewriteM3u8(new TextDecoder().decode(buffer), url),
      contentType: "application/vnd.apple.mpegurl",
      status: 200,
    };
  }

  const extraHeaders: Record<string, string> = {};
  const contentRange = res.headers.get("content-range");
  const acceptRanges = res.headers.get("accept-ranges");
  if (contentRange) extraHeaders["Content-Range"] = contentRange;
  if (acceptRanges) extraHeaders["Accept-Ranges"] = acceptRanges;

  return { body: buffer, contentType, status: res.status, extraHeaders };
}
