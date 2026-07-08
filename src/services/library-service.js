import fsp from "node:fs/promises";
import path from "node:path";
import { walkFiles } from "../lib/fs-utils.js";

const READY_STATUSES = ["completed", "installed"];

/**
 * Exposes finished downloads (single files or extracted directories) as a
 * flat list of files that clients can fetch individually with Range resume.
 */
export function createLibraryService({ manager }) {
  async function itemFor(d) {
    if (!d.filePath) return null;
    let stat;
    try {
      stat = await fsp.stat(d.filePath);
    } catch {
      return null; // deleted from disk behind our back
    }

    const name = path.basename(d.filePath);
    const files = stat.isDirectory()
      ? await walkFiles(d.filePath)
      : [{ path: name, size: stat.size }];

    return {
      id: d.id,
      name,
      status: d.status,
      createdAt: d.createdAt,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
      fileCount: files.length,
      files,
    };
  }

  return {
    async list() {
      const items = [];
      for (const d of manager.list()) {
        if (!READY_STATUSES.includes(d.status)) continue;
        const item = await itemFor(manager.get(d.id));
        if (item) items.push(item);
      }
      return items;
    },

    /** Resolve a library-relative path to an absolute one, refusing escapes. */
    async resolveFile(id, relPath) {
      const d = manager.get(id);
      if (!d || !READY_STATUSES.includes(d.status) || !d.filePath) return null;

      const stat = await fsp.stat(d.filePath).catch(() => null);
      if (!stat) return null;

      if (stat.isFile()) {
        return relPath === path.basename(d.filePath) ? d.filePath : null;
      }

      const base = path.resolve(d.filePath);
      const abs = path.resolve(base, relPath);
      if (abs !== base && !abs.startsWith(base + path.sep)) return null;
      const fileStat = await fsp.stat(abs).catch(() => null);
      return fileStat?.isFile() ? abs : null;
    },
  };
}
