export * from "./config.js";
export * from "./types/envelope.js";
export * from "./errors/index.js";
export * from "./hls/index.js";
export * from "./image/index.js";
export * from "./network/index.js";
export * from "./metadata/anilist.js";
export * from "./metadata/mal.js";
export * from "./metadata/jikan.js";
export * from "./metadata/kitsu.js";
export * from "./cache/index.js";
export * from "./telemetry/index.js";

export function translateId(encodedId: string): string {
  try {
    const padded = encodedId + "=".repeat((4 - (encodedId.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url").toString("utf-8");
    if (decoded.includes(":")) return decoded;
    return encodedId;
  } catch {
    return encodedId;
  }
}

export function deepTranslate(obj: unknown): void {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "id" && typeof value === "string") {
        record[key] = translateId(value);
      } else if (value && typeof value === "object") {
        deepTranslate(value);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object") deepTranslate(item);
    }
  }
}

export function injectSourceSlugs(
  data: Record<string, unknown>,
  anilistId: number,
): Record<string, unknown> {
  const providers = data.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers))
    return data;

  for (const [providerName, providerData] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    if (
      !providerData ||
      typeof providerData !== "object" ||
      Array.isArray(providerData)
    )
      continue;
    const prov = providerData as Record<string, unknown>;
    let episodes = prov.episodes;

    if (!episodes || typeof episodes !== "object") {
      if (Array.isArray(episodes)) {
        prov.episodes = { sub: episodes };
        episodes = prov.episodes;
      } else {
        continue;
      }
    }

    const epMap = episodes as Record<string, unknown>;
    for (const [category, epList] of Object.entries(epMap)) {
      if (!Array.isArray(epList)) continue;
      for (const ep of epList) {
        if (!ep || typeof ep !== "object") continue;
        const episode = ep as Record<string, unknown>;
        if ("id" in episode && "number" in episode) {
          const origId = String(episode.id);
          const prefix = origId.includes(":") ? origId.split(":")[0] : origId;
          episode.id = `watch/${providerName}/${anilistId}/${category}/${prefix}-${episode.number}`;
        }
      }
    }
  }
  return data;
}
