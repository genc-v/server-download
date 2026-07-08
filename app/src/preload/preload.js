const { contextBridge, ipcRenderer } = require("electron");

/** Unwrap the { ok, data | error } envelope from main. */
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
    start: (libraryItemId) => invoke("local:start", libraryItemId),
    pause: (id) => invoke("local:pause", id),
    resume: (id) => invoke("local:resume", id),
    cancel: (id) => invoke("local:cancel", id),
    remove: (id) => invoke("local:remove", id),
  },
});
