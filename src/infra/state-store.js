import fs from "node:fs";

/**
 * Debounced JSON persistence. The owner registers a `serialize` function;
 * callers flag changes with markDirty() and the store writes at most once
 * per autosave tick (plus a final synchronous flush on shutdown).
 */
export function createStateStore(statePath) {
  let dirty = false;
  let serialize = () => "[]";

  return {
    bind(serializeFn) {
      serialize = serializeFn;
    },

    markDirty() {
      dirty = true;
    },

    load() {
      try {
        return JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch {
        return null;
      }
    },

    flushSync() {
      try {
        fs.writeFileSync(statePath, serialize());
        dirty = false;
      } catch (error) {
        console.error("failed to save state:", error.message);
      }
    },

    startAutosave(intervalMs = 2000) {
      const timer = setInterval(() => {
        if (dirty) this.flushSync();
      }, intervalMs);
      timer.unref?.();
    },
  };
}
