export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export class MetadataError extends Error {
  readonly status: number;
  constructor(message = "Metadata query failed", status = 502) {
    super(message);
    this.name = "MetadataError";
    this.status = status;
  }
}

export class ProxyError extends Error {
  readonly status: number;
  constructor(message = "Proxy fetch failed", status = 502) {
    super(message);
    this.name = "ProxyError";
    this.status = status;
  }
}

export function handleError(err: unknown): { status: number; message: string } {
  if (err instanceof ProviderError)
    return { status: err.status, message: err.message };
  if (err instanceof MetadataError)
    return { status: err.status, message: err.message };
  if (err instanceof ProxyError)
    return { status: err.status, message: err.message };
  if (err instanceof Error) return { status: 500, message: err.message };
  return { status: 500, message: "Internal server error" };
}
