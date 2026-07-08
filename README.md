# server-downloader

Paste a hoster link in a web UI, the file downloads **on the machine running the server**, with live progress. Zero npm dependencies — needs only Node 18+.

## Run

```sh
node server.js
```

Then open http://localhost:3939. Files are saved to `./downloads/`.

To keep it running after you close the terminal (downloads live in the server
process, not the browser tab — the tab is just a viewer):

```sh
nohup node server.js > downloader.log 2>&1 &
```

## Supported links

| Hoster | How | Needs |
|---|---|---|
| Gofile (`gofile.io/d/...`) | Guest token + WT header (ported from Hydra) | nothing; optional `GOFILE_TOKEN` |
| Datanodes (`datanodes.to/...`) | Free-download form post | nothing |
| VikingFile | Hydra's private unlock backend | `NIMBUS_API_URL` env var |
| 1fichier | Official API | `FICHIER_API_KEY` env var (Premium account) |
| Any direct `http(s)` URL | Streamed as-is | nothing |

Password-protected Gofile links: use the optional password field in the UI.

## Config (env vars)

- `PORT` — HTTP port (default `3939`)
- `DOWNLOADS_DIR` — where files are saved (default `./downloads`)
- `GOFILE_TOKEN` — use your own Gofile account token instead of a guest token
- `NIMBUS_API_URL` — Hydra Nimbus backend base URL, enables VikingFile
- `FICHIER_API_KEY` — 1fichier Premium API key, enables 1fichier

## API

- `GET /api/downloads` — list downloads with progress
- `POST /api/downloads` — body `{"url": "...", "password": "..."}`
- `POST /api/downloads/:id/cancel`
- `POST /api/downloads/:id/retry` — restart a failed/cancelled download
- `DELETE /api/downloads/:id` — remove a finished/failed entry from the list

## Reliability

- Each download gets **3 attempts** (initial + 2 retries with backoff) before
  it's marked `error`. A **Retry** button in the UI restarts it with a fresh
  attempt budget.
- The download list is persisted to `state.json`. If the server crashes or is
  stopped, on the next start any download that was in flight (or failed with
  attempts left) is **picked up automatically**, resuming from the partial
  file via HTTP `Range` when the host supports it (falls back to restarting
  from zero when it doesn't).
- Cancelling via the UI deletes the partial file; crashes keep it so the
  resume has something to continue from.
