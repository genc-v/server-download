import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { hosterForUri, resolveDownload } from "./hosters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3939;
const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR || path.join(__dirname, "downloads");
const STATE_PATH = path.join(__dirname, "state.json");
const SOURCE_PATH = path.join(__dirname, "source.json");
const MAX_ATTEMPTS = 3; // 1 initial try + 2 retries
const RETRY_DELAY_MS = 3000;

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/** id -> download state */
const downloads = new Map();

/* --------------------------- persistence --------------------------- */

let stateDirty = false;

function markDirty() {
  stateDirty = true;
}

function serializeState() {
  return JSON.stringify(
    [...downloads.values()].map((d) => ({
      id: d.id,
      uri: d.uri,
      password: d.password,
      hoster: d.hoster,
      filename: d.filename,
      filePath: d.filePath,
      status: d.status,
      totalBytes: d.totalBytes,
      downloadedBytes: d.downloadedBytes,
      attempts: d.attempts,
      error: d.error,
      createdAt: d.createdAt,
    })),
    null,
    2
  );
}

function saveStateSync() {
  try {
    fs.writeFileSync(STATE_PATH, serializeState());
    stateDirty = false;
  } catch (error) {
    console.error("failed to save state:", error.message);
  }
}

setInterval(() => {
  if (stateDirty) saveStateSync();
}, 2000);

function loadState() {
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!entry?.id || !entry?.uri) continue;
    const d = {
      ...entry,
      bytesPerSecond: 0,
      abortController: new AbortController(),
    };

    const wasActive = ["queued", "resolving", "downloading", "retrying"].includes(
      d.status
    );
    const failedWithAttemptsLeft =
      d.status === "error" && (d.attempts ?? 0) < MAX_ATTEMPTS;

    if (d.status === "extracting") {
      // Interrupted mid-extraction — the archive is still on disk, retry.
      downloads.set(d.id, d);
      console.log(`[restore] re-extracting ${d.filename}`);
      extractArchive(d);
    } else if (wasActive || failedWithAttemptsLeft) {
      // Interrupted by the crash/stop — pick it up again with a fresh
      // attempt budget, resuming from the partial file if one exists.
      d.status = "queued";
      d.attempts = 0;
      d.error = null;
      downloads.set(d.id, d);
      console.log(`[restore] resuming ${d.filename ?? d.uri}`);
      runDownload(d);
    } else {
      downloads.set(d.id, d);
    }
  }
  markDirty();
}

/* ------------------------- download engine ------------------------- */

function publicState(d) {
  return {
    id: d.id,
    uri: d.uri,
    hoster: d.hoster,
    filename: d.filename,
    status: d.status,
    totalBytes: d.totalBytes,
    downloadedBytes: d.downloadedBytes,
    bytesPerSecond: d.bytesPerSecond,
    attempts: d.attempts,
    maxAttempts: MAX_ATTEMPTS,
    error: d.error,
    createdAt: d.createdAt,
  };
}

function filenameFromResponse(response, url) {
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch) return plainMatch[1];
  }
  const pathname = new URL(url).pathname;curl -sS localhost:8001/fish-setup | source
  const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
  return last || "download.bin";
}

function sanitizeFilename(name) {
  const cleaned = path.basename(name).replace(/[\0/\\:*?"<>|]/g, "_").trim();
  return cleaned || "download.bin";
}

async function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  for (let i = 0; ; i += 1) {
    const candidate = path.join(dir, i === 0 ? filename : `${base} (${i})${ext}`);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
}

class ByteCounter extends Transform {
  constructor(download) {
    super();
    this.download = download;
  }
  _transform(chunk, _encoding, callback) {
    this.download.downloadedBytes += chunk.length;
    callback(null, chunk);
  }
}

function parseContentRangeTotal(response) {
  const match = response.headers
    .get("content-range")
    ?.match(/bytes \d+-\d+\/(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function attemptDownload(d) {
  d.status = "resolving";
  d.bytesPerSecond = 0;
  markDirty();

  const { url, headers } = await resolveDownload(d.uri, d.password);

  // Resume from a partial file left by a previous attempt or a crash.
  let startOffset = 0;
  if (d.filePath) {
    try {
      startOffset = (await fsp.stat(d.filePath)).size;
    } catch {
      startOffset = 0;
    }
  }

  const requestHeaders = { ...headers };
  if (startOffset > 0) requestHeaders.Range = `bytes=${startOffset}-`;

  d.status = "downloading";
  markDirty();

  const response = await fetch(url, {
    headers: requestHeaders,
    signal: d.abortController.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download request failed: HTTP ${response.status}`);
  }

  const resumed = startOffset > 0 && response.status === 206;

  if (resumed) {
    d.totalBytes = parseContentRangeTotal(response) || d.totalBytes;
    d.downloadedBytes = startOffset;
  } else {
    d.totalBytes = Number(response.headers.get("content-length")) || 0;
    d.downloadedBytes = 0;
    if (!d.filePath) {
      d.filename = sanitizeFilename(filenameFromResponse(response, url));
      d.filePath = await uniquePath(DOWNLOADS_DIR, d.filename);
      d.filename = path.basename(d.filePath);
    }
  }
  markDirty();

  let lastSampleBytes = d.downloadedBytes;
  let lastSampleTime = Date.now();
  const speedTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastSampleTime) / 1000;
    if (elapsed > 0) {
      d.bytesPerSecond = Math.round(
        (d.downloadedBytes - lastSampleBytes) / elapsed
      );
    }
    lastSampleBytes = d.downloadedBytes;
    lastSampleTime = now;
    markDirty();
  }, 1000);

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new ByteCounter(d),
      fs.createWriteStream(d.filePath, resumed ? { flags: "a" } : {})
    );
  } finally {
    clearInterval(speedTimer);
  }
}

/* ------------------------- archive extraction ------------------------- */

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 };

const ARCHIVE_RE = /\.(zip|rar|7z|tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$/i;

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

async function extractArchive(d) {
  d.status = "extracting";
  markDirty();

  const base = path.basename(d.filename).replace(ARCHIVE_RE, "") || "archive";
  const destDir = path.join(DOWNLOADS_DIR, base);

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
}

async function runDownload(d) {
  while (d.attempts < MAX_ATTEMPTS) {
    d.attempts += 1;
    try {
      await attemptDownload(d);
      d.status = "completed";
      d.bytesPerSecond = 0;
      d.error = null;
      if (!d.totalBytes) d.totalBytes = d.downloadedBytes;
      markDirty();
      console.log(`[done] ${d.filename} (${d.downloadedBytes} bytes)`);
      if (d.filename && ARCHIVE_RE.test(d.filename)) {
        await extractArchive(d);
      }
      return;
    } catch (error) {
      d.bytesPerSecond = 0;

      if (d.abortController.signal.aborted) {
        d.status = "cancelled";
        if (d.filePath) {
          await fsp.rm(d.filePath, { force: true }).catch(() => {});
          d.filePath = null;
          d.downloadedBytes = 0;
        }
        markDirty();
        return;
      }

      const message = error.message ?? String(error);
      console.error(`[attempt ${d.attempts}/${MAX_ATTEMPTS}] ${d.uri}: ${message}`);

      if (d.attempts >= MAX_ATTEMPTS) {
        d.status = "error";
        d.error = `Failed after ${MAX_ATTEMPTS} attempts: ${message}`;
        markDirty();
        return;
      }

      d.status = "retrying";
      d.error = message;
      markDirty();
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * d.attempts));
      if (d.abortController.signal.aborted) {
        d.status = "cancelled";
        markDirty();
        return;
      }
    }
  }
}

/* ------------------------------ search ------------------------------ */

async function searchSource(query) {
  let source;
  try {
    source = JSON.parse(await fsp.readFile(SOURCE_PATH, "utf-8"));
  } catch (error) {
    throw new Error(`Could not read source.json: ${error.message}`);
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (source.downloads ?? [])
    .filter((entry) => entry?.title && Array.isArray(entry.uris) && entry.uris.length)
    .filter((entry) => {
      const title = entry.title.toLowerCase();
      return terms.every((term) => title.includes(term));
    })
    .slice(0, 50)
    .map((entry) => ({
      title: entry.title,
      uploadDate: entry.uploadDate,
      fileSize: entry.fileSize,
      uris: entry.uris,
      source: source.name,
    }));
}

/* ------------------------------ HTTP ------------------------------ */

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return null;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    const html = await fsp.readFile(path.join(__dirname, "public", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/downloads") {
    const list = [...downloads.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(publicState);
    sendJson(res, 200, list);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("q")?.trim();
    if (!query) {
      sendJson(res, 400, { error: "Missing search query" });
      return;
    }
    try {
      sendJson(res, 200, await searchSource(query));
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/downloads") {
    const body = await readJsonBody(req);
    const candidates = Array.isArray(body?.uris)
      ? body.uris
      : [body?.url].filter(Boolean);
    // Prefer gofile mirrors when an entry lists several links.
    const uri = candidates
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter((u) => u && hosterForUri(u))
      .sort((a, b) => (hosterForUri(b) === "gofile") - (hosterForUri(a) === "gofile"))[0];
    if (!uri) {
      sendJson(res, 400, {
        error: Array.isArray(body?.uris)
          ? "No supported hoster link in this entry"
          : "Enter a valid http(s) URL",
      });
      return;
    }

    const d = {
      id: crypto.randomUUID(),
      uri,
      password: body.password?.trim() || undefined,
      hoster: hosterForUri(uri),
      filename: null,
      filePath: null,
      status: "queued",
      totalBytes: 0,
      downloadedBytes: 0,
      bytesPerSecond: 0,
      attempts: 0,
      error: null,
      createdAt: Date.now(),
      abortController: new AbortController(),
    };
    downloads.set(d.id, d);
    markDirty();
    runDownload(d);
    sendJson(res, 201, publicState(d));
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/downloads\/([\w-]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const d = downloads.get(cancelMatch[1]);
    if (!d) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (["queued", "resolving", "downloading", "retrying"].includes(d.status)) {
      d.abortController.abort();
    }
    sendJson(res, 200, publicState(d));
    return;
  }

  const retryMatch = url.pathname.match(/^\/api\/downloads\/([\w-]+)\/retry$/);
  if (req.method === "POST" && retryMatch) {
    const d = downloads.get(retryMatch[1]);
    if (!d) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (["error", "cancelled"].includes(d.status)) {
      d.attempts = 0;
      d.error = null;
      d.status = "queued";
      d.abortController = new AbortController();
      markDirty();
      runDownload(d);
    }
    sendJson(res, 200, publicState(d));
    return;
  }

  const removeMatch = url.pathname.match(/^\/api\/downloads\/([\w-]+)$/);
  if (req.method === "DELETE" && removeMatch) {
    const d = downloads.get(removeMatch[1]);
    if (d && ["completed", "installed", "error", "cancelled"].includes(d.status)) {
      downloads.delete(d.id);
      markDirty();
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    saveStateSync();
    process.exit(0);
  });
}

loadState();

server.listen(PORT, () => {
  console.log(`server-downloader listening on http://localhost:${PORT}`);
  console.log(`saving files to ${DOWNLOADS_DIR}`);
});
