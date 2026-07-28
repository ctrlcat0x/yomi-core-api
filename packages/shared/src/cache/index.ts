const store = new Map<string, { value: unknown; expiresAt: number }>();
const pending = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (store.size >= 500) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;

  const inflight = pending.get(key) as Promise<T> | undefined;
  if (inflight) return inflight;

  const request = fn()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      return value;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

export const TTL = {
  search: 5 * 60 * 1000,
  info: 10 * 60 * 1000,
  episodes: 5 * 60 * 1000,
  stream: 2 * 60 * 1000,
  manga: 10 * 60 * 1000,
  booru: 5 * 60 * 1000,
} as const;

export function cacheStats() {
  return {
    size: store.size,
    pending: pending.size,
    keys: [...store.keys()].slice(0, 20),
  };
}
