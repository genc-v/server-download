import fs from "node:fs";
import fsp from "node:fs/promises";
import { sendJson } from "../lib/http.js";

export function createLibraryController({ libraryService }) {
  return {
    async list(req, res) {
      sendJson(res, 200, await libraryService.list());
    },

    /**
     * GET /api/library/:id/files/<rel path> — streams one file with HTTP
     * Range support so clients can pause/resume and survive network drops.
     */
    async serveFile(req, res, { params }) {
      const [id, rawPath] = params;
      const relPath = rawPath
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");

      const absPath = await libraryService.resolveFile(id, relPath);
      if (!absPath) {
        sendJson(res, 404, { error: "File not found" });
        return;
      }

      const { size } = await fsp.stat(absPath);
      const headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
      };

      let start = 0;
      let end = size - 1;
      let status = 200;

      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
        if (start >= size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          res.end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      }

      headers["Content-Length"] = end - start + 1;
      res.writeHead(status, headers);

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const stream = fs.createReadStream(absPath, { start, end });
      stream.pipe(res);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
    },
  };
}
