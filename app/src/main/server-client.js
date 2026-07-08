/** Thin HTTP client for the server-downloader REST API. */
function createServerClient(getBaseUrl) {
  function base() {
    const url = (getBaseUrl() || "").trim().replace(/\/+$/, "");
    if (!url) throw new Error("Server URL is not set (see Settings)");
    return url;
  }

  async function json(path, options) {
    const response = await fetch(base() + path, options);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error || `Server responded HTTP ${response.status}`);
    }
    return body;
  }

  return {
    search(query) {
      return json(`/api/search?q=${encodeURIComponent(query)}`);
    },

    downloads() {
      return json("/api/downloads");
    },

    addDownload({ uris, url, password }) {
      return json("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris, url, password }),
      });
    },

    /** action: pause | resume | cancel | retry */
    downloadAction(id, action) {
      return json(`/api/downloads/${id}/${action}`, { method: "POST" });
    },

    removeDownload(id) {
      return json(`/api/downloads/${id}`, { method: "DELETE" });
    },

    library() {
      return json("/api/library");
    },

    /** URL for one file of a library item, path encoded per segment. */
    fileUrl(itemId, relPath) {
      const encoded = relPath.split("/").map(encodeURIComponent).join("/");
      return `${base()}/api/library/${itemId}/files/${encoded}`;
    },
  };
}

module.exports = { createServerClient };
