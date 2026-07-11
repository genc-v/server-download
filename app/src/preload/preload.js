const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

contextBridge.exposeInMainWorld("api", {
  settings: {
    get: () => invoke("settings:get"),
    set: (patch) => invoke("settings:set", patch),
    chooseDir: () => invoke("settings:choose-dir"),
    diskFree: (dir) => invoke("disk:free", dir),
  },
  server: {
    search: (query) => invoke("server:search", query),
    downloads: () => invoke("server:downloads"),
    add: (entry) => invoke("server:add", entry),
    action: (id, action) => invoke("server:action", { id, action }),
    library: () => invoke("server:library"),
  },
  local: {
    list: () => invoke("local:list"),
    start: ({ id, coverUrl }) => invoke("local:start", { id, coverUrl }),
    pause: (id) => invoke("local:pause", id),
    resume: (id) => invoke("local:resume", id),
    cancel: (id) => invoke("local:cancel", id),
    remove: (id) => invoke("local:remove", id),
    extract: (id) => invoke("local:extract", id),
  },
  rawg: {
    list: (params) => invoke("rawg:list", params),
    game: (idOrSlug) => invoke("rawg:game", idOrSlug),
    screenshots: (idOrSlug) => invoke("rawg:screenshots", idOrSlug),
    search: (query) => invoke("rawg:search", query),
  },
  meta: {
    set: (name, coverUrl) => invoke("meta:set", { name, coverUrl }),
    get: (name) => invoke("meta:get", name),
  },
});
