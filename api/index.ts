import { handle } from "@hono/node-server/vercel";
import app from "../apps/server/src/routes/index.js";

export default handle(app);
