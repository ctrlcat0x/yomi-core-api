import type { Context, Next } from "hono";
import { config } from "../config.js";

export function telemetryMiddleware() {
  return async (c: Context, next: Next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    c.header("X-Response-Time", `${ms}ms`);
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      // Hook point for OpenTelemetry exporter wiring
      console.debug(
        `[otel] ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`,
      );
    }
  };
}

export function securityMiddleware() {
  return async (c: Context, next: Next) => {
    if (
      config.apiKey &&
      c.req.path.startsWith("/v1/") &&
      c.req.header(config.apiKeyHeader) !== config.apiKey
    ) {
      return c.json({ success: false, data: null, error: "Unauthorized" }, 401);
    }

    await next();
  };
}
