# server-downloader

Two pieces:

1. **Server** (`server.js` + `src/`) — runs on the machine with the big disk.
   Searches a `source.json` catalog, downloads from hosters, extracts
   archives, and serves the finished files over HTTP with Range support.
   Zero npm dependencies — needs only Node 18+.
2. **Desktop app** (`app/`) — Electron client. Search the source, queue
   downloads on the server, then pull finished items to your machine with
   pause / resume / automatic recovery from network failures.

## Server

```sh
node server.js
```

Then open http://localhost:3939. Files are saved to `./downloads/`.

To keep it running after you close the terminal (downloads live in the server
process, not the browser tab — the tab is just a viewer):

```sh
nohup node server.js > downloader.log 2>&1 &
```

### Architecture

```
server.js                     entry point: wires modules, starts HTTP
src/
  config.js                   env vars, paths, constants
  router.js                   route table -> controllers
  lib/
    http.js                   Router, readJsonBody, sendJson
    fs-utils.js               filename sanitizing, unique paths, dir walking
  infra/
    hosters.js                hoster link resolution (gofile, datanodes, …)
    state-store.js            debounced state.json persistence
  services/
    download-manager.js       download lifecycle: queue/pause/resume/retry/restore
    extractor.js              archive extraction (7z/unrar/unzip/bsdtar/tar)
    search-service.js         source.json search
    library-service.js        finished items as file lists, safe path resolution
  controllers/
    downloads-controller.js   /api/downloads CRUD + pause/resume/cancel/retry
    search-controller.js      /api/search
    library-controller.js     /api/library + Range file streaming
    static-controller.js      web UI
```

### Supported links

| Hoster | How | Needs |
|---|---|---|
| Gofile (`gofile.io/d/...`) | Guest token + WT header (ported from Hydra) | nothing; optional `GOFILE_TOKEN` |
| Datanodes (`datanodes.to/...`) | Free-download form post | nothing |
| VikingFile | Hydra's private unlock backend | `NIMBUS_API_URL` env var |
| 1fichier | Official API | `FICHIER_API_KEY` env var (Premium account) |
| Any direct `http(s)` URL | Streamed as-is | nothing |

Password-protected Gofile links: use the optional password field in the UI.

### Config (env vars)

- `PORT` — HTTP port (default `3939`)
- `DOWNLOADS_DIR` — where files are saved (default `./downloads`)
- `GOFILE_TOKEN` — use your own Gofile account token instead of a guest token
- `NIMBUS_API_URL` — Hydra Nimbus backend base URL, enables VikingFile
- `FICHIER_API_KEY` — 1fichier Premium API key, enables 1fichier

### API

- `GET /api/search?q=...` — search the `source.json` catalog
- `GET /api/downloads` — list downloads with progress
- `POST /api/downloads` — body `{"url": "..."}` or `{"uris": [...], "password": "..."}`
- `POST /api/downloads/:id/pause` — stop but keep the partial file
- `POST /api/downloads/:id/resume` — continue a paused download via Range
- `POST /api/downloads/:id/cancel` — stop and delete the partial file
- `POST /api/downloads/:id/retry` — restart a failed/cancelled download
- `DELETE /api/downloads/:id` — remove a finished/failed entry from the list
- `GET /api/library` — finished items with their file lists
- `GET /api/library/:id/files/<path>` — stream one file; supports `Range`

### Reliability

- Each download gets **3 attempts** (initial + 2 retries with backoff) before
  it's marked `error`. A **Retry** button restarts it with a fresh budget.
- **Pause** keeps the partial file; **Resume** continues from the exact byte
  via HTTP `Range` (falls back to restarting when the host doesn't support it).
- The download list is persisted to `state.json`. If the server crashes or is
  stopped, on the next start any in-flight download is **picked up
  automatically** from the partial file. Paused downloads stay paused.
- Cancelling deletes the partial file; crashes and pauses keep it.

## Desktop app

```sh
cd app
npm install
npm start
```

First run: open **Settings**, set the server URL (e.g. `http://192.168.1.10:3939`)
and choose a download folder.

- **Search** — search the source, queue an item; the *server* downloads and
  extracts it.
- **Downloads** — three sections: what the server is downloading (with
  pause/resume/cancel), finished items available to fetch, and local
  transfers.
- Local transfers survive **pause, network failures and app restarts**: every
  file is requested with a `Range` offset equal to what's already on disk, so
  they always continue where they left off. Failed connections retry with
  backoff (up to 10 consecutive failures) and any byte of progress resets the
  counter.
- Before starting, the app checks the destination volume has enough **free
  disk space** (needed bytes + 100 MB headroom) and refuses with a clear
  error if not.

### Keyboard & controller

Full keyboard and gamepad navigation (Xbox/PS/generic, via the browser
Gamepad API — no drivers or dependencies):

| Keyboard | Controller | Action |
|---|---|---|
| Arrow keys | D-pad / left stick | move focus (spatial, auto-repeat on hold) |
| Enter / Space | A / Cross | activate focused control |
| Escape | B / Circle | leave text field, else back to nav |
| 1 / 2 / 3 | LB / RB | switch page |
| `/` or Cmd+F | — | jump to search |

A 🎮 indicator appears in the sidebar when a controller connects. Focus is
preserved across the 1-second live re-renders of the downloads page.

App layout mirrors the server: `src/main/` (settings store, disk stats,
server API client, transfer manager, IPC), `src/preload/` (context bridge),
`src/renderer/` (pages: search, downloads, settings; `js/input/` for
focus-nav, keyboard, gamepad).
