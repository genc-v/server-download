import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import {
  filenameFromResponse,
  sanitizeFilename,
  uniquePath,
} from "../lib/fs-utils.js";

const ACTIVE_STATUSES = ["queued", "resolving", "downloading", "retrying"];

const EXTRACT_RETRY_DELAYS = [30_000, 60_000, 5 * 60_000, 15 * 60_000]; // 30s, 1m, 5m, 15m
const MAX_EXTRACT_ATTEMPTS = EXTRACT_RETRY_DELAYS.length;

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

/**
 * Owns the download lifecycle: queued -> resolving -> downloading ->
 * completed (-> extracting -> installed), with pause/resume, cancel,
 * retry-with-backoff and crash restore from persisted state.
 */
export function createDownloadManager({ config, stateStore, extractor, hosters }) {
  /** id -> download state */
  const downloads = new Map();

  stateStore.bind(() =>
    JSON.stringify(
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
        extractAttempts: d.extractAttempts,
        lastExtractAttempt: d.lastExtractAttempt,
      })),
      null,
      2
    )
  );

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
      maxAttempts: config.maxAttempts,
      error: d.error,
      createdAt: d.createdAt,
      canExtract: extractor.isArchive(d.filename),
    };
  }

  async function attemptDownload(d) {
    d.status = "resolving";
    d.bytesPerSecond = 0;
    stateStore.markDirty();

    const { url, headers } = await hosters.resolveDownload(d.uri, d.password);

    // Resume from a partial file left by a previous attempt, a pause or a crash.
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
    stateStore.markDirty();

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
        d.filePath = await uniquePath(config.downloadsDir, d.filename);
        d.filename = path.basename(d.filePath);
      }
    }
    stateStore.markDirty();

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
      stateStore.markDirty();
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

  /** Handle an abort: paused keeps the partial file, cancelled deletes it. */
  async function settleAbort(d) {
    if (d.pauseRequested) {
      d.pauseRequested = false;
      d.status = "paused";
      d.abortController = new AbortController();
    } else {
      d.status = "cancelled";
      if (d.filePath) {
        await fsp.rm(d.filePath, { force: true }).catch(() => {});
        d.filePath = null;
        d.downloadedBytes = 0;
      }
    }
    stateStore.markDirty();
  }

  async function runDownload(d) {
    while (d.attempts < config.maxAttempts) {
      d.attempts += 1;
      try {
        await attemptDownload(d);
        d.status = "completed";
        d.bytesPerSecond = 0;
        d.error = null;
        if (!d.totalBytes) d.totalBytes = d.downloadedBytes;
        stateStore.markDirty();
        console.log(`[done] ${d.filename} (${d.downloadedBytes} bytes)`);
        if (extractor.isArchive(d.filename)) {
          await extractor.extract(d);
        }
        return;
      } catch (error) {
        d.bytesPerSecond = 0;

        if (d.abortController.signal.aborted) {
          await settleAbort(d);
          return;
        }

        const message = error.message ?? String(error);
        console.error(
          `[attempt ${d.attempts}/${config.maxAttempts}] ${d.uri}: ${message}`
        );

        if (d.attempts >= config.maxAttempts) {
          d.status = "error";
          d.error = `Failed after ${config.maxAttempts} attempts: ${message}`;
          stateStore.markDirty();
          return;
        }

        d.status = "retrying";
        d.error = message;
        stateStore.markDirty();
        await new Promise((r) => setTimeout(r, config.retryDelayMs * d.attempts));
        if (d.abortController.signal.aborted) {
          await settleAbort(d);
          return;
        }
      }
    }
  }

  return {
    list() {
      return [...downloads.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(publicState);
    },

    get(id) {
      return downloads.get(id);
    },

    publicState,

    /** Pick the best supported uri out of the candidates and start it. */
    create({ uris, password }) {
      const uri = uris
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => u && hosters.hosterForUri(u))
        // Prefer gofile mirrors when an entry lists several links.
        .sort(
          (a, b) =>
            (hosters.hosterForUri(b) === "gofile") -
            (hosters.hosterForUri(a) === "gofile")
        )[0];
      if (!uri) return null;

      const d = {
        id: crypto.randomUUID(),
        uri,
        password: password?.trim() || undefined,
        hoster: hosters.hosterForUri(uri),
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
      stateStore.markDirty();
      runDownload(d);
      return d;
    },

    /** Stop but keep the partial file; resume() continues from it. */
    pause(id) {
      const d = downloads.get(id);
      if (!d) return null;
      if (ACTIVE_STATUSES.includes(d.status)) {
        d.pauseRequested = true;
        d.abortController.abort();
      }
      return d;
    },

    resume(id) {
      const d = downloads.get(id);
      if (!d) return null;
      if (d.status === "paused") {
        d.attempts = 0;
        d.error = null;
        d.status = "queued";
        d.abortController = new AbortController();
        stateStore.markDirty();
        runDownload(d);
      }
      return d;
    },

    /** Abort and delete the partial file. */
    cancel(id) {
      const d = downloads.get(id);
      if (!d) return null;
      if (ACTIVE_STATUSES.includes(d.status)) {
        d.abortController.abort();
      } else if (d.status === "paused") {
        d.status = "cancelled";
        if (d.filePath) {
          fsp.rm(d.filePath, { force: true }).catch(() => {});
          d.filePath = null;
          d.downloadedBytes = 0;
        }
        stateStore.markDirty();
      }
      return d;
    },

    /** Restart a failed/cancelled download with a fresh attempt budget. */
    retry(id) {
      const d = downloads.get(id);
      if (!d) return null;
      if (["error", "cancelled"].includes(d.status)) {
        d.attempts = 0;
        d.error = null;
        d.status = "queued";
        d.abortController = new AbortController();
        stateStore.markDirty();
        runDownload(d);
      }
      return d;
    },

    extract(id) {
      const d = downloads.get(id);
      if (!d) return null;
      if (d.status !== "completed") return d;
      if (!extractor.isArchive(d.filename)) return d;
      // Reset counters so periodic retry also resets on manual trigger
      d.extractAttempts = 0;
      d.lastExtractAttempt = null;
      extractor.extract(d);
      return d;
    },

    remove(id) {
      const d = downloads.get(id);
      if (d && ["completed", "installed", "error", "cancelled"].includes(d.status)) {
        downloads.delete(d.id);
        stateStore.markDirty();
      }
      return true;
    },

    /** Rebuild in-memory state from disk and pick interrupted work back up. */
    restore() {
      const entries = stateStore.load();
      if (!Array.isArray(entries)) return;

      for (const entry of entries) {
        if (!entry?.id || !entry?.uri) continue;
        const d = {
          ...entry,
          bytesPerSecond: 0,
          pauseRequested: false,
          abortController: new AbortController(),
        };

        const wasActive = ACTIVE_STATUSES.includes(d.status);
        const failedWithAttemptsLeft =
          d.status === "error" && (d.attempts ?? 0) < config.maxAttempts;

        if (d.status === "extracting") {
          // Interrupted mid-extraction — the archive is still on disk, retry.
          downloads.set(d.id, d);
          console.log(`[restore] re-extracting ${d.filename}`);
          extractor.extract(d);
        } else if (d.status === "completed" && extractor.isArchive(d.filename ?? "")) {
          // Download finished but extraction never succeeded — retry immediately.
          downloads.set(d.id, d);
          if ((d.extractAttempts ?? 0) < MAX_EXTRACT_ATTEMPTS) {
            d.extractAttempts = 0;
            d.lastExtractAttempt = null;
            console.log(`[restore] retrying extraction for ${d.filename}`);
            extractor.extract(d);
          }
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
          // completed / installed / paused / cancelled / exhausted errors
          // stay as they were; paused ones wait for an explicit resume.
          downloads.set(d.id, d);
        }
      }
      stateStore.markDirty();

      // Start periodic extraction retry after state is loaded.
      setInterval(() => {
        const now = Date.now();
        for (const d of downloads.values()) {
          if (d.status !== "completed") continue;
          if (!extractor.isArchive(d.filename ?? "")) continue;
          const attempts = d.extractAttempts ?? 0;
          if (attempts >= MAX_EXTRACT_ATTEMPTS) continue;
          const delay = EXTRACT_RETRY_DELAYS[attempts] ?? EXTRACT_RETRY_DELAYS.at(-1);
          const last = d.lastExtractAttempt ?? 0;
          if (now - last < delay) continue;
          d.extractAttempts = attempts + 1;
          d.lastExtractAttempt = now;
          console.log(`[extract retry ${d.extractAttempts}/${MAX_EXTRACT_ATTEMPTS}] ${d.filename}`);
          extractor.extract(d);
        }
      }, 15_000);
    },
  };
}
