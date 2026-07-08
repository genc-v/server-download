import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  root: ROOT,
  port: Number(process.env.PORT) || 3939,
  downloadsDir: process.env.DOWNLOADS_DIR || path.join(ROOT, "downloads"),
  statePath: path.join(ROOT, "state.json"),
  sourcePath: path.join(ROOT, "source.json"),
  publicDir: path.join(ROOT, "public"),
  maxAttempts: 3, // 1 initial try + 2 retries
  retryDelayMs: 3000,
};
