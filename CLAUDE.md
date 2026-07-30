# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Which workflow rules apply here

This repository runs **Engineering Workflow v1** from its own `.claude/` directory.
`.claude/project-config.yaml` is canonical, then `.claude/rules/`, then
`.claude/docs/command-architecture.md`.

A **second copy** of the same corpus is inherited from the parent directory
(`C:\Users\DELL\Desktop\CLAUDE.md` and `Desktop\.claude\rules\`). Claude Code loads
both, so both are in context. **The copy in this repository always wins.** The
inherited copy is written for a different project, and it disagrees on three
points:

| Point | Inherited copy (ignore) | This repo (use) |
|---|---|---|
| Mission | a local observability stack | MediaServing, the media API |
| Guardrail | `observability/**` is a hard stop | `protected_paths` in `project-config.yaml`; `observability/**` is edited freely |
| ADR numbers | ADR-009, 010, 012, 013 | the same decisions are **+2**: ADR-011, 012, 014, 015 |

Read any `observability/**` rule in the inherited copy as "any path listed in
`protected_paths`". The implementation branch is `ticket/<slug>`, cut from clean
`main` — this repository has no `develop` branch.

## What this is

A self-hosted, Cloudinary-like media processing API. Originals are uploaded once to S3-compatible storage; transformed/derived media is generated on demand (or pre-generated at upload), cached back into S3, and served on subsequent requests. Both **images** (Sharp) and **videos** (FFmpeg) are supported, plus spreadsheet uploads (`api/files.js`), HLS stories, a BullMQ video worker, and a Loki-backed stats dashboard.

## Commands

```bash
npm run dev          # dev: loads .env.development, node --watch auto-restart
npm start            # prod: loads .env.production, NODE_ENV=production
npm run worker       # BullMQ worker — heavy video variants; separate process,
                     # required or polished video variants are never generated

# Local infra (MinIO + Redis + Loki + Grafana)
docker compose up    # app on :3000, MinIO :9000/console :9001, Grafana :3200

# Cloudinary → S3 migration (originals only)
npm run migrate:dry  # list without uploading
npm run migrate      # default limit 20
npm run migrate:full # --limit 0 (unlimited)

# Backfill video variants for already-uploaded originals
npm run preprocess-videos
npm run preprocess-videos:dry

# Fetch a remote video and upload it (optionally as a story)
npm run fetch-video
npm run fetch-video:story
```

There is **no test runner, linter, or formatter** configured. `ffmpeg`/`ffprobe` must be on PATH (the Docker image installs them via apk; override with `FFMPEG_PATH`/`FFPROBE_PATH`).

## Architecture

`index.js` → `app.js` (`buildApp()`) wires Fastify with four route groups: `api/upload.js`, `api/transform.js`, `api/stats.js`, `api/files.js` (spreadsheets: `POST /upload/excel`, `GET /file/upload/*`). `src/worker.js` is a second, separate entry point for the video queue. Request flow for delivery:

1. **`GET /:resourceType/upload/*`** (`transform.js`) is the single delivery route. `:resourceType` is `image`, `video`, or the legacy alias `media` (auto-detected from file extension via `isVideoPath`). The wildcard is split by `parsePath` into Cloudinary-style transformation segments (`w_300,h_200,c_fill/...`) and the file path. A segment counts as transformations only if **every** comma token is a known key (see `isTransformationSegment` in `paramParser.js`).
2. The original always lives at S3 key `originals/<filePath>`. The derived/cached object lives at `derived/<sha256>/<name>.<ext>`, where the hash is computed by `hashGenerator.generateDerivedKey(originalKey, params)` over the original key plus **alphabetically-sorted** params — so `w_300,h_300` and `h_300,w_300` collapse to one cache entry.
3. Cache-aside with locking: `checkCache` → if miss, `acquireLock` (Redis `SET NX EX 30`, in-memory fallback) → **re-check cache** → fetch original → process → `saveToCache` → `releaseLock`. A request that fails to get the lock calls `serveFromCacheOrWait` (sleeps 2s, re-checks, else returns **503**). `cacheService.js` and `lockService.js` are thin wrappers — the cache *is* S3 (`objectExists`/`putObject`).

### Image vs. video behavior diverges sharply

- **Images** (`handleImage`): URL transform params are honored **except format is forced to `webp`** for normal browsers (JPEG for social crawlers, see `resolveDefaultImageFormat` + `isSocialCrawler`). The one exception is `f_svg` on a `.svg` source, which serves the original untouched. `q_auto[:eco|low|good|best]` is resolved to a concrete integer (`resolveQAuto`) *before* hashing, to keep cache keys deterministic.
- **Videos** (`handleVideo`): **all URL transform params are ignored.** Variants are selected only via the `?target=` query param: `snapshot` (1s webp frame), `webp` (poster), `preview` (short clip), `story` / `story-fallback` (vertical MP4s), or omitted (`full`). Each target maps to a fixed preset and its own cache key. Videos support HTTP Range requests (206 partial responses) for `full`/`preview`/`story` targets; snapshot/webp do not.

### Video variant presets live in services, not the route

`services/videoPreprocessor.js` defines `full`/`preview`/`webp`/`snapshot` presets and `getVariantUrls`. `services/storyVideoService.js` defines the `story`/`story-fallback` MP4 presets and `getStoryUrls`. Presets are transform strings (e.g. `w_540,h_960,f_mp4,vc_h264,q_54,c_fit`) overridable via env vars, parsed into params by `parseParams`. `processors/videoProcessor.js` does the actual FFmpeg work (`processVideo`, `extractSnapshot`, `extractRawFrame`, `probe`, plus `processStoryHls` for multi-rendition HLS). When editing a preset or codec mapping, remember the cache key embeds those params — changing a preset orphans existing cache entries rather than overwriting them.

### Upload splits video work: cheap parts inline, heavy parts on a worker

`POST /upload` and `POST /upload/bulk` (`upload.js`) stream multipart parts, collecting all `field` parts first so `folder` is available regardless of part order. For images, upload just stores the original. For **videos** (`upload.js:207-254`), after storing: `probeMedia` rejects an unreadable file (400) or one over `MAX_VIDEO_DURATION_SECONDS` (400); then the **snapshot and webp poster are generated inline** because image targets need them immediately; then an **instant variant** is generated inline *only* if `isWebPlayable` says the source won't play as-is. Poster/instant failures are logged, not fatal. Finally the **heavy polished variants are enqueued** (`enqueueVideoJob`) and the request returns without waiting.

The queue is BullMQ on Redis (`services/videoQueue.js`), consumed by a **separate process** — `npm run worker` → `src/worker.js` → `services/videoJobs.js`. Jobs dedupe on `jobId: originalKey`, retry `VIDEO_JOB_ATTEMPTS` (3) with exponential backoff, and are dropped on success (`removeOnComplete: true`) or kept 24 h on failure. If the worker isn't running, uploads still succeed and posters appear — the polished variants simply never exist.

`?story=true` switches the video to story preset generation. Story uploads are size-capped at 10 MB. Bulk responses return only basenames (`path.basename`), single returns the full item with `url`/`variants`.

### Auth & rate limiting

`middleware/auth.js` is a global `preHandler`: it **allowlists** `/metrics`, `/health`, `/test*`, `/compare*`, `/stats*`, OPTIONS, and any URL containing `/media|image|video|file/upload/` — note `/file/upload/` means uploaded **spreadsheets are publicly downloadable**. Everything else (effectively `POST /upload`, `/upload/bulk`, `/upload/excel`) requires a matching `X-API-Key` header against `API_KEY`. Rate limiting (`@fastify/rate-limit`) keys by API key (`k:<key>`) or IP (`ip:<ip>`), backed by Redis when `RATE_LIMIT_STORE=redis`; social-preview crawlers are allowlisted on public media GETs so previews aren't throttled.

### Observability

Structured Pino JSON logs (custom level labels, ISO timestamps, `x-api-key`/`authorization` redacted). One log line per request via `onRequest`/`onResponse` hooks; handlers attach extra fields through `request._logExtra` (set by `stampLogExtra`, which maps cache status to `transformed: warm|cold|bypass` for Loki cache-ratio queries). `api/stats.js` serves `stats.html` and proxies LogQL queries to Loki — directly via `LOKI_QUERY_URL`, or through Grafana's datasource proxy when `GRAFANA_URL` + `GRAFANA_TOKEN` are set.

## Conventions & gotchas

- `config/env.js` loads `.env.<NODE_ENV>` then `.env`, with `override: false` (real env vars win). `s3Client.js` only sets a custom `endpoint` when not production — prod assumes real AWS S3.
- Param parsing is centralized in `utils/paramParser.js`. Crop aliases are normalized (`cover→fill`, `contain→fit`); fit semantics are remapped again per-engine (`processors/imageProcessor.js` `fitMap` for Sharp, `buildFilterChain` for FFmpeg). Add new transform keys to `KNOWN_TRANSFORM_KEYS` *and* `parseParams`, or `isTransformationSegment` will treat the URL segment as a file path.
- The `customers/profile` folder is special-cased in `upload.js` to return a bare `/<path>` URL instead of a `/image/upload/...` delivery URL.
- HLS story playlists are rewritten so segment/variant URIs point back through `?target=story&asset=...`; asset names are sanitized against path traversal (`sanitizeAssetName`).
