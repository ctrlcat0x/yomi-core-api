import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@yomi/anime-core": fromRoot("./packages/anime-core/src/index.ts"),
      "@yomi/hentai-core": fromRoot("./packages/hentai-core/src/index.ts"),
      "@yomi/manga-core": fromRoot("./packages/manga-core/src/index.ts"),
      "@yomi/shared": fromRoot("./packages/shared/src/index.ts"),
    },
  },
});
