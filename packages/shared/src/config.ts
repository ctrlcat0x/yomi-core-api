export const config = {
  port: Number(process.env.PORT ?? 3000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .filter(Boolean),
  apiKey: process.env.API_KEY,
  apiKeyHeader: "x-api-key",
  anilistUrl: "https://graphql.anilist.co",
  anilistToken: process.env.ANILIST_TOKEN,
  malClientId: process.env.MAL_CLIENT_ID,
  miruroPipeMirrors: parseMirrors(
    process.env.MIRURO_PIPE_MIRRORS ??
      "https://www.miruro.tv/api/secure/pipe|true,https://www.miruro.bz/api/secure/pipe|true,https://www.miruro.ru/api/secure/pipe|true,https://www.miruro.to/api/secure/pipe|false,https://miruro.to/api/secure/pipe|false",
  ),
  anikotoBaseUrl: process.env.ANIKOTO_BASE_URL ?? "https://anikototv.to",
  booruCredentials: {
    rule34: {
      api_key: process.env.BOORU_RULE34_API_KEY,
      user_id: process.env.BOORU_RULE34_USER_ID,
    },
    gelbooru: {
      api_key: process.env.BOORU_GELBOORU_API_KEY,
    },
  },
  redisUrl: process.env.REDIS_URL,
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  streamHeaders: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.miruro.to/",
    Accept: "*/*",
  },
} as const;

function parseMirrors(raw: string): [string, boolean][] {
  return raw.split(",").flatMap((pair): [string, boolean][] => {
    const [url, verify] = pair.includes("|") ? pair.split("|") : [pair, "true"];
    const normalizedUrl = url?.trim();
    if (!normalizedUrl) return [];
    return [[normalizedUrl, verify?.toLowerCase() !== "false"]];
  });
}
