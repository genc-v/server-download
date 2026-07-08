const fsp = require("node:fs/promises");
const path = require("node:path");

/**
 * Free bytes on the volume holding `dir`. Walks up to the nearest existing
 * ancestor so it also works before the download folder has been created.
 */
async function freeBytes(dir) {
  let probe = path.resolve(dir);
  for (;;) {
    try {
      const stats = await fsp.statfs(probe);
      return stats.bavail * stats.bsize;
    } catch (error) {
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

module.exports = { freeBytes };
