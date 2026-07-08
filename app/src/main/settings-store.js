const fs = require("node:fs");
const path = require("node:path");

/** Tiny JSON settings file with defaults. */
function createSettingsStore(filePath, defaults) {
  let settings = { ...defaults };
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch {
    /* first run */
  }

  return {
    get() {
      return { ...settings };
    },

    set(patch) {
      settings = { ...settings, ...patch };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
      return { ...settings };
    },
  };
}

module.exports = { createSettingsStore };
