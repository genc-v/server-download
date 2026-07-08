import fs from "node:fs";
import http from "node:http";

import { config } from "./src/config.js";
import * as hosters from "./src/infra/hosters.js";
import { createStateStore } from "./src/infra/state-store.js";
import { createExtractor } from "./src/services/extractor.js";
import { createDownloadManager } from "./src/services/download-manager.js";
import { createSearchService } from "./src/services/search-service.js";
import { createLibraryService } from "./src/services/library-service.js";
import { createDownloadsController } from "./src/controllers/downloads-controller.js";
import { createSearchController } from "./src/controllers/search-controller.js";
import { createLibraryController } from "./src/controllers/library-controller.js";
import { createStaticController } from "./src/controllers/static-controller.js";
import { createRouter } from "./src/router.js";

fs.mkdirSync(config.downloadsDir, { recursive: true });

/* infra */
const stateStore = createStateStore(config.statePath);

/* services */
const extractor = createExtractor({
  downloadsDir: config.downloadsDir,
  markDirty: () => stateStore.markDirty(),
});
const manager = createDownloadManager({ config, stateStore, extractor, hosters });
const searchService = createSearchService({ sourcePath: config.sourcePath });
const libraryService = createLibraryService({ manager });

/* http */
const router = createRouter({
  controllers: {
    downloads: createDownloadsController({ manager }),
    search: createSearchController({ searchService }),
    library: createLibraryController({ libraryService }),
    statics: createStaticController({ publicDir: config.publicDir }),
  },
});

const server = http.createServer((req, res) => router.dispatch(req, res));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stateStore.flushSync();
    process.exit(0);
  });
}

manager.restore();
stateStore.startAutosave();

server.listen(config.port, () => {
  console.log(`server-downloader listening on http://localhost:${config.port}`);
  console.log(`saving files to ${config.downloadsDir}`);
});
