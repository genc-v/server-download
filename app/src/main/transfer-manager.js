const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const { freeBytes } = require("./disk");
const { extractAll } = require("./extract");

const ACTIVE_STATUSES = ["queued", "checking", "downloading", "retrying"];
const MAX_CONSECUTIVE_FAILURES = 10;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 30000;
const DISK_MARGIN_BYTES = 100 * 1024 * 1024; // keep 100 MB headroom

/**
 * Downloads library items (lists of files) from the server to a local
 * folder. Progress lives on disk: every file is fetched with a Range offset
 * equal to what is already present, so pause, crash or network loss all
 * resume from the exact byte where they stopped.
 */
function createTransferManager({ stateFile, serverClient }) {
  /** id -> job */
  const jobs = new Map();
  let saveTimer = null;

  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const plain = [...jobs.values()].map((job) => ({
        id: job.id,
        serverId: job.serverId,
        name: job.name,
        coverUrl: job.coverUrl,
        destDir: job.destDir,
        files: job.files,
        status: job.status,
        totalBytes: job.totalBytes,
        downloadedBytes: job.downloadedBytes,
        error: job.error,
        createdAt: job.createdAt,
      }));
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFile(stateFile, JSON.stringify(plain, null, 2), () => {});
    }, 500);
  }

  function publicState(job) {
    return {
      id: job.id,
      serverId: job.serverId,
      name: job.name,
      coverUrl: job.coverUrl,
      destDir: job.destDir,
      status: job.status,
      totalBytes: job.totalBytes,
      downloadedBytes: job.downloadedBytes,
      bytesPerSecond: job.bytesPerSecond,
      currentFile: job.currentFile,
      fileCount: job.files.length,
      error: job.error,
      createdAt: job.createdAt,
      extractStatus: job.extractStatus || null,
      extractError: job.extractError || null,
    };
  }

  function localPathFor(job, file) {
    return path.join(job.destDir, job.name, ...file.path.split("/"));
  }

  /** Bytes already on disk for this job (capped at each file's size). */
  async function bytesOnDisk(job) {
    let have = 0;
    for (const file of job.files) {
      const stat = await fsp.stat(localPathFor(job, file)).catch(() => null);
      if (stat) have += Math.min(stat.size, file.size);
    }
    return have;
  }

  async function ensureDiskSpace(job) {
    const have = await bytesOnDisk(job);
    const needed = job.totalBytes - have + DISK_MARGIN_BYTES;
    const free = await freeBytes(job.destDir);
    if (free < needed) {
      const gb = (n) => (n / 1024 ** 3).toFixed(2) + " GB";
      throw Object.assign(
        new Error(
          `Not enough disk space: need ${gb(needed)} free, only ${gb(free)} available`
        ),
        { fatal: true }
      );
    }
    return have;
  }

  /** Download one file, resuming from whatever is already on disk. */
  async function fetchFile(job, file) {
    const localPath = localPathFor(job, file);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });

    let offset = (await fsp.stat(localPath).catch(() => null))?.size ?? 0;
    if (offset > file.size) offset = 0; // stale leftover from another item
    if (offset === file.size) return;

    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    const response = await fetch(serverClient.fileUrl(job.serverId, file.path), {
      headers,
      signal: job.abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${file.path}`);
    }

    // Server ignored the Range header — start this file over.
    const resumed = offset > 0 && response.status === 206;
    if (!resumed && offset > 0) {
      job.downloadedBytes -= offset;
      offset = 0;
    }

    let fileBytes = offset;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        fileBytes += chunk.length;
        job.downloadedBytes += chunk.length;
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body),
      counter,
      fs.createWriteStream(localPath, resumed ? { flags: "a" } : {})
    );

    if (fileBytes !== file.size) {
      throw new Error(
        `Size mismatch for ${file.path}: got ${fileBytes}, expected ${file.size}`
      );
    }
  }

  async function settlePause(job) {
    if (job.pauseRequested) {
      job.pauseRequested = false;
      job.status = "paused";
      job.abortController = new AbortController();
    } else {
      job.status = "cancelled";
    }
    job.bytesPerSecond = 0;
    persist();
  }

  async function run(job) {
    job.status = "checking";
    job.error = null;
    persist();

    let lastSampleBytes = 0;
    let lastSampleTime = Date.now();
    const speedTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastSampleTime) / 1000;
      if (elapsed > 0) {
        job.bytesPerSecond = Math.max(
          0,
          Math.round((job.downloadedBytes - lastSampleBytes) / elapsed)
        );
      }
      lastSampleBytes = job.downloadedBytes;
      lastSampleTime = now;
      persist();
    }, 1000);

    let consecutiveFailures = 0;
    try {
      job.downloadedBytes = await ensureDiskSpace(job);
      lastSampleBytes = job.downloadedBytes;

      for (let i = 0; i < job.files.length; ) {
        const file = job.files[i];
        job.currentFile = file.path;
        job.status = "downloading";
        persist();

        const before = job.downloadedBytes;
        try {
          await fetchFile(job, file);
          consecutiveFailures = 0;
          i += 1;
        } catch (error) {
          if (job.abortController.signal.aborted) {
            await settlePause(job);
            return;
          }
          if (error.fatal) throw error;

          // Any byte progress counts as a working connection again.
          if (job.downloadedBytes > before) consecutiveFailures = 0;
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new Error(
              `Giving up after ${consecutiveFailures} failed attempts: ${error.message}`
            );
          }

          job.status = "retrying";
          job.error = error.message;
          job.bytesPerSecond = 0;
          persist();
          const delay = Math.min(
            RETRY_BASE_MS * consecutiveFailures,
            RETRY_MAX_MS
          );
          await new Promise((r) => setTimeout(r, delay));
          if (job.abortController.signal.aborted) {
            await settlePause(job);
            return;
          }
        }
      }

      job.status = "completed";
      job.currentFile = null;
      job.error = null;
      job.bytesPerSecond = 0;
      persist();
    } catch (error) {
      if (job.abortController.signal.aborted) {
        await settlePause(job);
      } else {
        job.status = "error";
        job.error = error.message;
        job.bytesPerSecond = 0;
        persist();
      }
    } finally {
      clearInterval(speedTimer);
    }
  }

  return {
    list() {
      return [...jobs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(publicState);
    },

    /** Start fetching a server library item into destDir. */
    start(libraryItem, destDir, coverUrl) {
      const existing = [...jobs.values()].find(
        (job) =>
          job.serverId === libraryItem.id &&
          ACTIVE_STATUSES.concat("paused").includes(job.status)
      );
      if (existing) return publicState(existing);

      const job = {
        id: crypto.randomUUID(),
        serverId: libraryItem.id,
        name: libraryItem.name,
        coverUrl: coverUrl || null,
        destDir,
        files: libraryItem.files,
        status: "queued",
        totalBytes: libraryItem.totalBytes,
        downloadedBytes: 0,
        bytesPerSecond: 0,
        currentFile: null,
        error: null,
        createdAt: Date.now(),
        pauseRequested: false,
        abortController: new AbortController(),
      };
      jobs.set(job.id, job);
      persist();
      run(job);
      return publicState(job);
    },

    pause(id) {
      const job = jobs.get(id);
      if (job && ACTIVE_STATUSES.includes(job.status)) {
        job.pauseRequested = true;
        job.abortController.abort();
      }
      return job ? publicState(job) : null;
    },

    resume(id) {
      const job = jobs.get(id);
      if (job && ["paused", "error", "cancelled"].includes(job.status)) {
        job.abortController = new AbortController();
        run(job);
      }
      return job ? publicState(job) : null;
    },

    /** Stop and delete everything already fetched for this job. */
    async cancel(id) {
      const job = jobs.get(id);
      if (!job) return null;
      if (ACTIVE_STATUSES.includes(job.status)) {
        job.abortController.abort();
      }
      job.status = "cancelled";
      await fsp
        .rm(path.join(job.destDir, job.name), { recursive: true, force: true })
        .catch(() => {});
      job.downloadedBytes = 0;
      persist();
      return publicState(job);
    },

    /** Forget a finished/failed job (keeps downloaded files). */
    remove(id) {
      const job = jobs.get(id);
      if (job && !ACTIVE_STATUSES.includes(job.status)) {
        jobs.delete(id);
        persist();
      }
      return true;
    },

    /** Extract archive files inside the job's downloaded folder. */
    async extract(id) {
      const job = jobs.get(id);
      if (!job) throw new Error("Job not found");
      if (job.extractStatus === "extracting") return publicState(job);

      const dir = path.join(job.destDir, job.name);
      job.extractStatus = "extracting";
      job.extractError = null;
      persist();

      extractAll(dir).then((result) => {
        job.extractStatus = result.failed > 0 && result.failed === result.total
          ? "error"
          : "done";
        job.extractError = result.errors.length ? result.errors.join("; ") : null;
        persist();
      }).catch((err) => {
        job.extractStatus = "error";
        job.extractError = err.message;
        persist();
      });

      return publicState(job);
    },

    /** Reload persisted jobs; anything that was mid-flight resumes. */
    restore() {
      let entries;
      try {
        entries = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      } catch {
        return;
      }
      if (!Array.isArray(entries)) return;

      for (const entry of entries) {
        if (!entry?.id || !entry?.serverId) continue;
        const job = {
          ...entry,
          bytesPerSecond: 0,
          currentFile: null,
          pauseRequested: false,
          abortController: new AbortController(),
        };
        jobs.set(job.id, job);
        if (ACTIVE_STATUSES.includes(job.status)) {
          run(job); // continue where it left off
        }
      }
    },
  };
}

module.exports = { createTransferManager };
