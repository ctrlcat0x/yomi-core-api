import app from "../apps/server/src/routes/index.js";

export default function handler(
  request: Request,
): Promise<Response> | Response {
  return app.fetch(request);
}
