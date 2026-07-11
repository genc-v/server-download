import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const downloadsDir = process.env.DOWNLOADS_DIR || path.join(ROOT, "downloads");

export const config = {
  root: ROOT,
  port: Number(process.env.PORT) || 3939,
  downloadsDir,
  statePath: process.env.STATE_PATH || path.join(path.dirname(downloadsDir), "state.json"),
  sourcePath: process.env.SOURCE_PATH || path.join(ROOT, "source.json"),
  publicDir: path.join(ROOT, "public"),
  maxAttempts: 3, // 1 initial try + 2 retries
  retryDelayMs: 3000,
};
