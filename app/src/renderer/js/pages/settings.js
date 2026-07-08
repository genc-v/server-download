"use strict";

App.pages.settings = (() => {
  const { bytes } = App.format;

  const serverUrlInput = () => document.getElementById("setting-server-url");
  const downloadDirInput = () => document.getElementById("setting-download-dir");
  const chooseDirBtn = () => document.getElementById("choose-dir-btn");
  const diskFreeBox = () => document.getElementById("disk-free");
  const statusBox = () => document.getElementById("settings-status");

  async function refreshDiskFree(dir) {
    if (!dir) {
      diskFreeBox().textContent = "";
      return;
    }
    try {
      const free = await window.api.settings.diskFree(dir);
      diskFreeBox().textContent = `Free space on that volume: ${bytes(free)}`;
    } catch {
      diskFreeBox().textContent = "";
    }
  }

  async function load() {
    const settings = await window.api.settings.get();
    serverUrlInput().value = settings.serverUrl ?? "";
    downloadDirInput().value = settings.downloadDir ?? "";
    refreshDiskFree(settings.downloadDir);
  }

  async function saveServerUrl() {
    const serverUrl = serverUrlInput().value.trim();
    await window.api.settings.set({ serverUrl });
    statusBox().textContent = "Saved";
    setTimeout(() => (statusBox().textContent = ""), 1500);
  }

  async function chooseDir() {
    const settings = await window.api.settings.chooseDir();
    if (settings) {
      downloadDirInput().value = settings.downloadDir;
      refreshDiskFree(settings.downloadDir);
    }
  }

  return {
    init() {
      serverUrlInput().addEventListener("change", saveServerUrl);
      chooseDirBtn().addEventListener("click", chooseDir);
    },
    show() {
      load();
    },
  };
})();
