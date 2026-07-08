import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 };

export const ARCHIVE_RE = /\.(zip|rar|7z|tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$/i;

const toolCache = new Map();
async function hasTool(name) {
  if (!toolCache.has(name)) {
    toolCache.set(
      name,
      execFileAsync("/bin/sh", ["-c", `command -v ${name}`])
        .then(() => true)
        .catch(() => false)
    );
  }
  return toolCache.get(name);
}

async function extractCommand(filePath, destDir, password) {
  const lower = filePath.toLowerCase();

  for (const sevenZip of ["7zz", "7z"]) {
    if (await hasTool(sevenZip)) {
      const args = ["x", "-y", `-o${destDir}`];
      if (password) args.push(`-p${password}`);
      return [sevenZip, [...args, filePath]];
    }
  }

  if (lower.endsWith(".rar") && (await hasTool("unrar"))) {
    const args = ["x", "-y", password ? `-p${password}` : "-p-"];
    return ["unrar", [...args, filePath, `${destDir}/`]];
  }

  if (lower.endsWith(".zip") && (await hasTool("unzip"))) {
    const args = ["-o"];
    if (password) args.push("-P", password);
    return ["unzip", [...args, filePath, "-d", destDir]];
  }

  // bsdtar/libarchive handles zip, rar, 7z and all tar variants.
  if (await hasTool("bsdtar")) {
    const args = ["-xf", filePath, "-C", destDir];
    if (password) args.unshift("--passphrase", password);
    return ["bsdtar", args];
  }
  if (!lower.endsWith(".rar") && !lower.endsWith(".7z") && (await hasTool("tar"))) {
    return ["tar", ["-xf", filePath, "-C", destDir]];
  }

  return null;
}

export function createExtractor({ downloadsDir, markDirty }) {
  return {
    isArchive(filename) {
      return ARCHIVE_RE.test(filename ?? "");
    },

    /** Unpack d.filePath next to it, then swap d.filePath to the directory. */
    async extract(d) {
      d.status = "extracting";
      markDirty();

      const base = path.basename(d.filename).replace(ARCHIVE_RE, "") || "archive";
      const destDir = path.join(downloadsDir, base);

      try {
        const command = await extractCommand(d.filePath, destDir, d.password);
        if (!command) {
          throw new Error("no extraction tool available for this archive type");
        }

        await fsp.mkdir(destDir, { recursive: true });
        console.log(`[extract] ${d.filename} -> ${destDir} (${command[0]})`);
        await execFileAsync(command[0], command[1], EXEC_OPTS);

        // Archive unpacked fine — the original file is no longer needed.
        await fsp.rm(d.filePath, { force: true });
        d.filePath = destDir;
        d.status = "installed";
        d.error = null;
        markDirty();
        console.log(`[installed] ${d.filename} -> ${destDir}`);
      } catch (error) {
        // Keep the archive so the user still has the download.
        await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
        const message = (error.stderr || error.message || String(error)).trim();
        d.status = "completed";
        d.error = `Downloaded, but extraction failed: ${message}`;
        markDirty();
        console.error(`[extract failed] ${d.filename}: ${message}`);
      }
    },
  };
}
