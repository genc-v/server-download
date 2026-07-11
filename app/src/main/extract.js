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

function run(cmd, args, cwd) {
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
  let last;
  for (const [cmd, args, cwd] of attempts) {
    try {
      await run(cmd, args, cwd);
      return;
    } catch (err) {
      last = err;
      if (!err.message.includes("not found")) throw err;
    }
  }
  throw last;
}

async function extractOne(archivePath) {
  const lower = archivePath.toLowerCase();
  const dest = path.dirname(archivePath);

  if (lower.endsWith(".zip")) {
    return run("unzip", ["-o", archivePath, "-d", dest], dest);
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return run("tar", ["-xzf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.bz2")) {
    return run("tar", ["-xjf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.xz")) {
    return run("tar", ["-xJf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar.zst")) {
    return run("tar", ["--zstd", "-xf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".tar")) {
    return run("tar", ["-xf", archivePath, "-C", dest], dest);
  }
  if (lower.endsWith(".zst")) {
    return tryCommands([
      ["zstd", ["-d", archivePath, "-o", path.join(dest, path.basename(archivePath, ".zst"))], dest],
    ]);
  }
  if (lower.endsWith(".gz")) {
    return run("gunzip", ["-kf", archivePath], dest);
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
    ]);
  }
  throw new Error(`Unsupported format: ${path.basename(archivePath)}`);
}

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

module.exports = { extractAll, findArchives, isArchive };
