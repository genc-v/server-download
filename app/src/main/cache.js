const fs = require("node:fs");
const path = require("node:path");

/** Disk-backed key/value cache with per-entry TTL. */
function createCache(filePath) {
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    /* first run */
  }

  // Drop already-expired entries from the previous session.
  const now = Date.now();
  for (const key of Object.keys(store)) {
    if (!store[key] || store[key].exp < now) delete store[key];
  }

  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFile(filePath, JSON.stringify(store), () => {});
    }, 1000);
  }

  return {
    get(key) {
      const hit = store[key];
      if (!hit) return undefined;
      if (hit.exp < Date.now()) {
        delete store[key];
        save();
        return undefined;
      }
      return hit.v;
    },

    set(key, value, ttlMs) {
      store[key] = { v: value, exp: Date.now() + ttlMs };
      save();
    },
  };
}

module.exports = { createCache };
