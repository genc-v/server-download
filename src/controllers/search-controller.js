import { sendJson } from "../lib/http.js";

export function createSearchController({ searchService }) {
  return {
    async search(req, res, { url }) {
      const query = url.searchParams.get("q")?.trim();
      if (!query) {
        sendJson(res, 400, { error: "Missing search query" });
        return;
      }
      try {
        sendJson(res, 200, await searchService.search(query));
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
    },
  };
}
