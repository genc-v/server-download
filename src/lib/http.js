export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return null;
  }
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Minimal method + regex router. Handlers receive (req, res, ctx) where
 * ctx = { url: URL, params: string[] } and params are the raw regex groups.
 */
export class Router {
  #routes = [];

  #add(method, pattern, handler) {
    this.#routes.push({ method, pattern, handler });
    return this;
  }

  get(pattern, handler) {
    return this.#add("GET", pattern, handler);
  }
  post(pattern, handler) {
    return this.#add("POST", pattern, handler);
  }
  delete(pattern, handler) {
    return this.#add("DELETE", pattern, handler);
  }

  async dispatch(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const route of this.#routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      try {
        await route.handler(req, res, { url, params: match.slice(1) });
      } catch (error) {
        console.error(`[http] ${req.method} ${url.pathname}:`, error);
        if (!res.headersSent) {
          sendJson(res, 500, { error: error.message ?? "Internal error" });
        } else {
          res.destroy();
        }
      }
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  }
}
