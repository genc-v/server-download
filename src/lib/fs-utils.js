import fsp from "node:fs/promises";
import path from "node:path";

export function sanitizeFilename(name) {
  const cleaned = path.basename(name).replace(/[\0/\\:*?"<>|]/g, "_").trim();
  return cleaned || "download.bin";
}

export function filenameFromResponse(response, url) {
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch) return plainMatch[1];
  }
  const pathname = new URL(url).pathname;
  const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
  return last || "download.bin";
}

export async function uniquePath(dir, filename) {
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

/** Recursively list files under root as { path: "rel/posix/path", size }. */
export async function walkFiles(root) {
  const files = [];
  async function walk(dir, rel) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, relPath);
      } else if (entry.isFile()) {
        const { size } = await fsp.stat(abs);
        files.push({ path: relPath, size });
      }
    }
  }
  await walk(root, "");
  return files;
}
