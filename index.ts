import { Hono } from "hono";
import routes from "./apps/server/src/routes/index.js";

const app = new Hono();
app.route("/", routes);

export { app };
export default app;
