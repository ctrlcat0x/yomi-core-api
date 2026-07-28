import { handle } from "hono/vercel";
import app from "../apps/server/src/routes/index.js";

export default handle(app);
