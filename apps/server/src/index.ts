import { config } from "../../../packages/shared/src";
import { app } from "./routes/index.js";

const port = config.port;

if (import.meta.main) {
  console.log(`Yomi Core API listening on http://localhost:${port}`);
  console.log(`Playground: http://localhost:${port}/playground`);
  Bun.serve({ port, fetch: app.fetch });
}

export { app };
