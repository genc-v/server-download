import fsp from "node:fs/promises";

export function createSearchService({ sourcePath }) {
  return {
    async search(query) {
      let source;
      try {
        source = JSON.parse(await fsp.readFile(sourcePath, "utf-8"));
      } catch (error) {
        throw new Error(`Could not read source.json: ${error.message}`);
      }

      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return (source.downloads ?? [])
        .filter(
          (entry) =>
            entry?.title && Array.isArray(entry.uris) && entry.uris.length
        )
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
    },
  };
}
