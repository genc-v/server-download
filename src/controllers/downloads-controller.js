import { readJsonBody, sendJson } from "../lib/http.js";

export function createDownloadsController({ manager }) {
  function action(name) {
    return (req, res, { params }) => {
      const d = manager[name](params[0]);
      if (!d) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      sendJson(res, 200, manager.publicState(d));
    };
  }

  return {
    list(req, res) {
      sendJson(res, 200, manager.list());
    },

    async create(req, res) {
      const body = await readJsonBody(req);
      const uris = Array.isArray(body?.uris)
        ? body.uris
        : [body?.url].filter(Boolean);

      const d = manager.create({ uris, password: body?.password });
      if (!d) {
        sendJson(res, 400, {
          error: Array.isArray(body?.uris)
            ? "No supported hoster link in this entry"
            : "Enter a valid http(s) URL",
        });
        return;
      }
      sendJson(res, 201, manager.publicState(d));
    },

    pause: action("pause"),
    resume: action("resume"),
    cancel: action("cancel"),
    retry: action("retry"),
    extract: action("extract"),

    remove(req, res, { params }) {
      manager.remove(params[0]);
      sendJson(res, 200, { ok: true });
    },
  };
}
