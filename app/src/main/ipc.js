const https = require("node:https");
const { dialog, ipcMain } = require("electron");
const { freeBytes } = require("./disk");

const HOUR = 3600 * 1000;
const TTL = {
  list: 12 * HOUR,      // discovery rows / genre grids
  search: 24 * HOUR,    // search results
  game: 7 * 24 * HOUR,  // game details rarely change
  shots: 7 * 24 * HOUR, // screenshots never change
};

function rawgFetch(path, apiKey) {
  return new Promise((resolve, reject) => {
    const sep = path.includes("?") ? "&" : "?";
    const url = `https://api.rawg.io/api${path}${sep}key=${encodeURIComponent(apiKey)}`;
    const req = https.get(url, { headers: { "User-Agent": "server-downloader-app/1.0" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`RAWG API error: HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          reject(new Error("Invalid JSON from RAWG"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("RAWG request timed out")));
  });
}

function registerIpc({ settings, serverClient, transfers, cache }) {
  const coverMeta = new Map();
  const inFlight = new Map(); // dedupe concurrent identical requests

  function apiKey() {
    const { rawgApiKey } = settings.get();
    if (!rawgApiKey) throw new Error("Add your RAWG API key in Settings to browse games");
    return rawgApiKey;
  }

  /** Cache-first RAWG fetch with in-flight dedupe. */
  function cachedRawg(path, ttl) {
    const hit = cache.get(path);
    if (hit !== undefined) return Promise.resolve(hit);
    if (inFlight.has(path)) return inFlight.get(path);
    const promise = rawgFetch(path, apiKey())
      .then((data) => {
        cache.set(path, data, ttl);
        inFlight.delete(path);
        return data;
      })
      .catch((err) => {
        inFlight.delete(path);
        throw err;
      });
    inFlight.set(path, promise);
    return promise;
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (error) {
        return { ok: false, error: error.message ?? String(error) };
      }
    });
  }

  /* settings */
  handle("settings:get", () => settings.get());
  handle("settings:set", (patch) => settings.set(patch));
  handle("settings:choose-dir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return settings.set({ downloadDir: result.filePaths[0] });
  });
  handle("disk:free", (dir) => freeBytes(dir || settings.get().downloadDir || "."));

  /* server-side downloads */
  handle("server:search", (query) => serverClient.search(query));
  handle("server:downloads", () => serverClient.downloads());
  handle("server:add", (entry) => serverClient.addDownload(entry));
  handle("server:action", ({ id, action }) => {
    if (action === "remove") return serverClient.removeDownload(id);
    return serverClient.downloadAction(id, action);
  });
  handle("server:library", () => serverClient.library());

  /* local transfers */
  handle("local:list", () => transfers.list());
  handle("local:start", async ({ id: libraryItemId, coverUrl }) => {
    const destDir = settings.get().downloadDir;
    if (!destDir) throw new Error("Choose a download folder in Settings first");
    const items = await serverClient.library();
    const item = items.find((e) => e.id === libraryItemId);
    if (!item) throw new Error("Item is no longer available on the server");
    return transfers.start(item, destDir, coverUrl || null);
  });
  handle("local:pause", (id) => transfers.pause(id));
  handle("local:resume", (id) => transfers.resume(id));
  handle("local:cancel", (id) => transfers.cancel(id));
  handle("local:remove", (id) => transfers.remove(id));
  handle("local:extract", (id) => transfers.extract(id));

  /* cover art metadata */
  handle("meta:set", ({ name, coverUrl }) => {
    if (name && coverUrl) coverMeta.set(name.toLowerCase(), coverUrl);
    return true;
  });
  handle("meta:get", (name) => (name ? coverMeta.get(name.toLowerCase()) || null : null));

  /* RAWG game database (all cached) */
  handle("rawg:list", (params = {}) => {
    const p = new URLSearchParams();
    p.set("page_size", String(params.page_size || 20));
    if (params.page) p.set("page", String(params.page));
    if (params.ordering) p.set("ordering", params.ordering);
    if (params.genres) p.set("genres", String(params.genres));
    if (params.metacritic) p.set("metacritic", params.metacritic);
    if (params.dates) p.set("dates", params.dates);
    if (params.search) p.set("search", params.search);
    const ttl = params.search ? TTL.search : TTL.list;
    return cachedRawg(`/games?${p}`, ttl);
  });

  handle("rawg:game", (idOrSlug) =>
    cachedRawg(`/games/${encodeURIComponent(idOrSlug)}`, TTL.game)
  );

  handle("rawg:screenshots", (idOrSlug) =>
    cachedRawg(`/games/${encodeURIComponent(idOrSlug)}/screenshots?page_size=12`, TTL.shots)
  );

  /* single best-match search (used when we only know a title) */
  handle("rawg:search", async (query) => {
    const { rawgApiKey } = settings.get();
    if (!rawgApiKey) return null;
    const data = await cachedRawg(
      `/games?search=${encodeURIComponent(query)}&page_size=1&search_precise=true`,
      TTL.search
    );
    return data.results?.[0] || null;
  });
}

module.exports = { registerIpc };
