import { Router } from "./lib/http.js";

export function createRouter({ controllers }) {
  const { downloads, search, library, statics } = controllers;
  const router = new Router();

  router.get(/^\/$/, statics.index);

  router.get(/^\/api\/search$/, search.search);

  router.get(/^\/api\/downloads$/, downloads.list);
  router.post(/^\/api\/downloads$/, downloads.create);
  router.post(/^\/api\/downloads\/([\w-]+)\/pause$/, downloads.pause);
  router.post(/^\/api\/downloads\/([\w-]+)\/resume$/, downloads.resume);
  router.post(/^\/api\/downloads\/([\w-]+)\/cancel$/, downloads.cancel);
  router.post(/^\/api\/downloads\/([\w-]+)\/retry$/, downloads.retry);
  router.post(/^\/api\/downloads\/([\w-]+)\/extract$/, downloads.extract);
  router.delete(/^\/api\/downloads\/([\w-]+)$/, downloads.remove);

  router.get(/^\/api\/library$/, library.list);
  router.get(/^\/api\/library\/([\w-]+)\/files\/(.+)$/, library.serveFile);

  return router;
}
