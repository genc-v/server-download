import fsp from "node:fs/promises";
import path from "node:path";

export function createStaticController({ publicDir }) {
  return {
    async index(req, res) {
      const html = await fsp.readFile(path.join(publicDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    },
  };
}
