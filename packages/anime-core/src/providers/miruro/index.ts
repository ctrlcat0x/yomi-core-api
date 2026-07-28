import { gunzipSync } from "node:zlib";
import {
  ProviderError,
  config,
  deepTranslate,
  injectSourceSlugs,
} from "../../../../shared/src";

export interface PipePayload {
  path: string;
  method: string;
  query: Record<string, unknown>;
  body: unknown;
  version: string;
}

export function encodePipeRequest(payload: PipePayload): string {
  return Buffer.from(JSON.stringify(payload))
    .toString("base64url")
    .replace(/=+$/, "");
}

export function decodePipeResponse(
  encodedStr: string,
): Record<string, unknown> {
  try {
    const padded = encodedStr + "=".repeat((4 - (encodedStr.length % 4)) % 4);
    const compressed = Buffer.from(padded, "base64url");
    const json = gunzipSync(compressed).toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new ProviderError("Failed to decode pipe response");
  }
}

async function fetchPipe(encodedReq: string): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  const headers = {
    "User-Agent": config.userAgent,
    Referer: "https://www.miruro.to/",
  };

  for (const [pipeUrl, verifySsl] of config.miruroPipeMirrors) {
    try {
      const res = await fetch(`${pipeUrl}?e=${encodedReq}`, {
        headers,
        // Bun fetch ignores TLS verify in some cases; best-effort
      });
      if (!res.ok) {
        errors.push(`${pipeUrl}: HTTP ${res.status}`);
        continue;
      }
      const text = (await res.text()).trim();
      return decodePipeResponse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      errors.push(`${pipeUrl}: ${msg}${verifySsl ? "" : ""}`);
    }
  }

  throw new ProviderError(
    `Miruro pipe unreachable. ${errors.slice(0, 3).join("; ")}`,
  );
}

export async function fetchRawEpisodes(
  anilistId: number,
): Promise<Record<string, unknown>> {
  const payload: PipePayload = {
    path: "episodes",
    method: "GET",
    query: { anilistId },
    body: null,
    version: "0.1.0",
  };
  const data = await fetchPipe(encodePipeRequest(payload));
  deepTranslate(data);
  return injectSourceSlugs(data, anilistId);
}

export async function getMiruroSources(
  episodeId: string,
  provider: string,
  anilistId: number,
  category: string,
): Promise<Record<string, unknown>> {
  const encId = Buffer.from(episodeId).toString("base64url").replace(/=+$/, "");
  const payload: PipePayload = {
    path: "sources",
    method: "GET",
    query: { episodeId: encId, provider, category, anilistId },
    body: null,
    version: "0.1.0",
  };
  return fetchPipe(encodePipeRequest(payload));
}

export async function resolveMiruroWatchSlug(
  provider: string,
  anilistId: number,
  category: string,
  slug: string,
): Promise<Record<string, unknown>> {
  const payload: PipePayload = {
    path: "episodes",
    method: "GET",
    query: { anilistId },
    body: null,
    version: "0.1.0",
  };
  const data = await fetchPipe(encodePipeRequest(payload));
  deepTranslate(data);

  const provData = (data.providers as Record<string, unknown>)?.[provider] as
    | Record<string, unknown>
    | undefined;
  const epList = ((provData?.episodes as Record<string, unknown>)?.[category] ??
    []) as Array<Record<string, unknown>>;

  let targetId: string | null = null;
  for (const ep of epList) {
    const origId = String(ep.id ?? "");
    const prefix = origId.includes(":") ? origId.split(":")[0] : origId;
    if (`${prefix}-${ep.number}` === slug) {
      targetId = origId;
      break;
    }
  }

  if (!targetId)
    throw new ProviderError(`Episode slug '${slug}' not found`, 404);
  return getMiruroSources(targetId, provider, anilistId, category);
}

export const miruroProvider = {
  id: "miruro" as const,
  fetchEpisodes: fetchRawEpisodes,
  getSources: getMiruroSources,
  resolveWatchSlug: resolveMiruroWatchSlug,
};
