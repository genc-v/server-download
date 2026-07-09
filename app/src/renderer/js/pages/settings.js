"use strict";

App.pages.settings = (() => {
  const { bytes } = App.format;

  function render() {
    document.getElementById("view-settings").innerHTML = `
      <div class="settings-body">
        <h2 class="settings-title">Settings</h2>

        <label class="field">
          <span class="field-label">Server URL</span>
          <input type="text" id="s-server-url" placeholder="http://192.168.1.10:3939" />
        </label>

        <label class="field">
          <span class="field-label">RAWG API Key <span class="field-hint">· get a free key at rawg.io</span></span>
          <input type="text" id="s-rawg-key" placeholder="Paste your RAWG API key…" />
        </label>

        <label class="field">
          <span class="field-label">Download folder</span>
          <div class="dir-row">
            <input type="text" id="s-dl-dir" readonly placeholder="Not set" />
            <button class="dir-btn" id="s-choose-dir">Choose…</button>
          </div>
          <div class="settings-meta" id="s-disk-free"></div>
        </label>

        <div class="settings-status" id="s-status"></div>
      </div>`;

    load();
    bindEvents();
  }

  async function load() {
    const st = await window.api.settings.get();
    document.getElementById("s-server-url").value = st.serverUrl ?? "";
    document.getElementById("s-rawg-key").value   = st.rawgApiKey ?? "";
    document.getElementById("s-dl-dir").value     = st.downloadDir ?? "";
    refreshDisk(st.downloadDir);
  }

  async function refreshDisk(dir) {
    const el = document.getElementById("s-disk-free");
    if (!el) return;
    if (!dir) { el.textContent = ""; return; }
    try {
      const free = await window.api.settings.diskFree(dir);
      el.textContent = `Free space: ${bytes(free)}`;
    } catch { el.textContent = ""; }
  }

  function status(msg) {
    const el = document.getElementById("s-status");
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 1800);
  }

  async function save(patch) {
    await window.api.settings.set(patch);
    status("Saved");
  }

  function bindEvents() {
    document.getElementById("s-server-url").addEventListener("change", (e) =>
      save({ serverUrl: e.target.value.trim() })
    );
    document.getElementById("s-rawg-key").addEventListener("change", (e) =>
      save({ rawgApiKey: e.target.value.trim() })
    );
    document.getElementById("s-choose-dir").addEventListener("click", async () => {
      const st = await window.api.settings.chooseDir();
      if (st) {
        document.getElementById("s-dl-dir").value = st.downloadDir;
        refreshDisk(st.downloadDir);
      }
    });
  }

  return {
    init() {},
    show() { render(); },
  };
})();
