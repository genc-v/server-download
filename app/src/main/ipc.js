const { dialog, ipcMain } = require("electron");
const { freeBytes } = require("./disk");

function registerIpc({ settings, serverClient, transfers }) {
  /* Every handler returns { ok, data | error } so the renderer never has to
     parse Electron's mangled thrown-error messages. */
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
  handle("local:start", async (libraryItemId) => {
    const destDir = settings.get().downloadDir;
    if (!destDir) {
      throw new Error("Choose a download folder in Settings first");
    }
    const items = await serverClient.library();
    const item = items.find((entry) => entry.id === libraryItemId);
    if (!item) throw new Error("Item is no longer available on the server");
    return transfers.start(item, destDir);
  });
  handle("local:pause", (id) => transfers.pause(id));
  handle("local:resume", (id) => transfers.resume(id));
  handle("local:cancel", (id) => transfers.cancel(id));
  handle("local:remove", (id) => transfers.remove(id));
}

module.exports = { registerIpc };
