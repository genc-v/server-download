const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const { createSettingsStore } = require("./settings-store");
const { createServerClient } = require("./server-client");
const { createTransferManager } = require("./transfer-manager");
const { registerIpc } = require("./ipc");

function createWindow() {
  const window = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#16171c",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");

  const settings = createSettingsStore(path.join(userData, "settings.json"), {
    serverUrl: "http://localhost:3939",
    downloadDir: "",
  });
  const serverClient = createServerClient(() => settings.get().serverUrl);
  const transfers = createTransferManager({
    stateFile: path.join(userData, "transfers.json"),
    serverClient,
  });

  registerIpc({ settings, serverClient, transfers });
  transfers.restore();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running on macOS convention only if windows can be reopened;
  // transfers continue while the process is alive.
  if (process.platform !== "darwin") app.quit();
});
