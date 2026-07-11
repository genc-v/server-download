"use strict";

const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ARCHIVE_EXTS = [
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.zst",
  ".gz",
  ".zst",
];

function isArchive(filename) {
  const lower = filename.toLowerCase();
  return ARCHIVE_EXTS.some((ext) => lower.endsWith(ext));
}

async function findArchives(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && isArchive(entry.name)) {
      found.push(full);
    } else if (entry.isDirectory()) {
      const nested = await findArchives(full);
      found.push(...nested);
    }
  }
  return found;
}

function runCmd(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "pipe" });
    const errChunks = [];
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = Buffer.concat(errChunks).toString().trim();
        reject(new Error(`${cmd} exited with code ${code}${msg ? ": " + msg : ""}`));
      }
    });
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error(`"${cmd}" not found — install it to extract this format`));
      } else {
        reject(err);
      }
    });
  });
}

async function tryCommands(attempts) {
  for (const [cmd, args, cwd] of attempts) {
    try {
      await runCmd(cmd, args, cwd);
      return;
    } catch (err) {
      // Only keep trying if this command simply isn't installed
      if (!err.message.includes("not found")) throw err;
    }
  }
  // All candidates missing — give a clear message listing what to install
  const cmds = [...new Set(attempts.map(([c]) => c))].join(", ");
  throw new Error(`None of the required tools are installed (${cmds}). Install one to extract this format.`);
}

async function extractOne(archivePath) {
  const lower = archivePath.toLowerCase();
  const dest = path.dirname(archivePath);

  if (lower.endsWith(".zip")) {
    return runCmd("unzip", ["-o", archivePath, "-d", dest], dest);
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return runCmd("tar", ["-xzf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.bz2")) {
    return runCmd("tar", ["-xjf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.xz")) {
    return runCmd("tar", ["-xJf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.zst")) {
    return runCmd("tar", ["--zstd", "-xf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar")) {
    return runCmd("tar", ["-xf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".zst")) {
    return tryCommands([
      ["zstd", ["-d", archivePath, "-o", path.join(dest, path.basename(archivePath, ".zst"))], dest],
    ]);
  }
  if (lower.endsWith(".gz")) {
    // -k keeps original; we remove it ourselves below
    return runCmd("gunzip", ["-kf", archivePath], dest);
  }
  if (lower.endsWith(".7z")) {
    return tryCommands([
      ["7z",  ["x", archivePath, `-o${dest}`, "-y"], dest],
      ["7za", ["x", archivePath, `-o${dest}`, "-y"], dest],
      ["7zz", ["x", archivePath, `-o${dest}`, "-y"], dest],
    ]);
  }
  if (lower.endsWith(".rar")) {
    return tryCommands([
      ["unrar", ["x", "-o+", archivePath, dest + "/"], dest],
      ["rar",   ["x", "-o+", archivePath, dest + "/"], dest],
      ["7z",    ["x", archivePath, `-o${dest}`, "-y"], dest],
      ["7za",   ["x", archivePath, `-o${dest}`, "-y"], dest],
      ["7zz",   ["x", archivePath, `-o${dest}`, "-y"], dest],
    ]);
  }
  throw new Error(`Unsupported format: ${path.basename(archivePath)}`);
}

/**
 * Find every archive in `dir`, extract each one next to itself,
 * then delete the archive file. Skips files that fail to extract
 * unless ALL of them fail (in which case throws).
 *
 * Returns { total, failed, errors }.
 */
async function extractAndClean(dir) {
  const archives = await findArchives(dir);
  if (!archives.length) return { total: 0, failed: 0, errors: [] };

  const errors = [];
  for (const archive of archives) {
    try {
      await extractOne(archive);
      await fsp.rm(archive, { force: true });
    } catch (err) {
      errors.push(`${path.basename(archive)}: ${err.message}`);
    }
  }

  if (errors.length === archives.length && archives.length > 0) {
    throw new Error(errors.join("; "));
  }

  return { total: archives.length, failed: errors.length, errors };
}

/**
 * Same as extractAndClean but keeps the original archives.
 * Used by the manual Extract button in the UI.
 */
async function extractAll(dir) {
  const archives = await findArchives(dir);
  if (!archives.length) {
    throw new Error("No archive files found in the downloaded folder");
  }
  const errors = [];
  for (const archive of archives) {
    try {
      await extractOne(archive);
    } catch (err) {
      errors.push(`${path.basename(archive)}: ${err.message}`);
    }
  }
  if (errors.length === archives.length) {
    throw new Error(errors.join("; "));
  }
  return { total: archives.length, failed: errors.length, errors };
}

module.exports = { extractAndClean, extractAll, findArchives, isArchive };
