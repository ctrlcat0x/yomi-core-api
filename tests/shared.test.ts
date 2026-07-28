import { parseTagString, serializeSearchableTags } from "@yomi/hentai-core";
import { assertPublicHttpUrl, isM3u8, rewriteM3u8 } from "@yomi/shared";
import { describe, expect, it } from "vitest";

describe("HLS proxy", () => {
  it("detects m3u8 content", () => {
    const body = Buffer.from("#EXTM3U\n#EXTINF:10,\nsegment.ts\n");
    expect(
      isM3u8("http://x.com/play.m3u8", "application/vnd.apple.mpegurl", body),
    ).toBe(true);
  });

  it("rewrites segment URLs", () => {
    const content = "#EXTM3U\nsegment.ts\n";
    const out = rewriteM3u8(
      content,
      "https://cdn.example.com/path/master.m3u8",
    );
    expect(out).toContain("/v1/proxy/hls?url=");
    expect(out).toContain("segment.ts");
  });
});

describe("Tag serialization", () => {
  it("parses negative tags", () => {
    expect(parseTagString("cat -dog")).toEqual([
      { name: "cat", modifier: "+" },
      { name: "dog", modifier: "-" },
    ]);
  });

  it("serializes modifiers", () => {
    const s = serializeSearchableTags([
      { name: "cat", modifier: "+" },
      { name: "dog", modifier: "-" },
    ]);
    expect(s).toContain("cat");
    expect(s).toContain("-dog");
  });
});

describe("API envelope", () => {
  it("health endpoint shape", async () => {
    const { app } = await import("../apps/server/src/routes/index.js");
    const res = await app.request("/health");
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("ok");
  });
});

describe("Proxy URL validation", () => {
  it("accepts public HTTP URLs", () => {
    expect(
      assertPublicHttpUrl("https://cdn.example.com/file.jpg").hostname,
    ).toBe("cdn.example.com");
  });

  it.each([
    "http://localhost/file",
    "http://127.0.0.1/file",
    "http://10.0.0.1/file",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ])("rejects private or non-HTTP URL %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow();
  });
});
