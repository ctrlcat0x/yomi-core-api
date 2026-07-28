import app from "../apps/server/src/routes/index.js";

export default {
  fetch(request: Request): Promise<Response> | Response {
    return app.fetch(request);
  },
};
