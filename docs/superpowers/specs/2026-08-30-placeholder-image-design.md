# Placeholder image instead of a broken response

**Date:** 2026-08-30
**Status:** approved
**Branch:** `main`

## Problem

When the delivery route cannot produce an image, it returns a JSON error body.
A browser `<img>` tag then shows its own broken-image icon. The page looks
damaged.

Today three things go wrong in `src/api/transform.js`:

| Case | Line | Current response |
|---|---|---|
| Original missing in S3 | 471, 654, 761, 900 | `404 {"error":"Original file not found"}` |
| S3 unreachable or 5xx | 473, 763 | rethrown, becomes `500 {"error":"Internal server error"}` |
| Sharp or FFmpeg throws | 506, 855 | rethrown, becomes `500` |

We want a real image instead. But a placeholder must **never** stick around
after the real image comes back.

## Where a placeholder could get stuck

Three caches sit between the processor and the user. Each needs its own answer.

1. **S3 `derived/` cache.** `saveToCache` writes the derived object. It runs
   only after a successful transform. A placeholder path that never calls
   `saveToCache` cannot poison this layer. The guarantee is structural.
2. **`Cache-Control` header.** This is the real danger. `setMediaCacheHeaders`
   sends `public, max-age=31536000, immutable`. A placeholder sent with that
   header is pinned in every browser and in the CDN for a year.
3. **The CDN.** Corrected 2026-08-30: the live CDN is **Cloudflare**, not
   CloudFront. `CLOUDFRONT_CDN_ROLLOUT.md` in this repo describes a plan that
   was not the one adopted. The real config is the Terraform in the sibling
   `TrydosApp/cf-worker/infra/cache.tf`, on zone `ramaaz.dev`, hostname
   `media.ramaaz.dev`. Two of its rules cover our paths:

   | Rule | Matches | Edge TTL |
   |---|---|---|
   | `media_reads_no_query` | `/image/upload/*` | `respect_origin` |
   | `media_reads_video_target` | `/video/upload/*`, `/media/upload/*` | `respect_origin` |

   `respect_origin` means Cloudflare obeys the origin `Cache-Control`, so
   `no-store` keeps the placeholder out of the edge cache. The setting that
   would break this is `edge_ttl.mode = "override_origin"`, which ignores
   `Cache-Control` entirely — it must never be set on those two rules.
   `cache = true` on rule 1 sets cache *eligibility* (it overrides Cloudflare's
   file-extension list), not TTL, so it does not defeat `no-store`.

   Both rules also set `serve_stale.disable_stale_while_updating = false`. On a
   storage outage Cloudflare serves the last good copy, so the `500` placeholder
   never reaches a user whose edge already holds that image. The placeholder is
   for genuinely missing files and cold URLs.

## Decisions

| ID | Decision | Reason |
|---|---|---|
| D1 | The placeholder response **keeps the real status code** (`404` / `500`). Only the body changes, from JSON to image bytes. | A browser draws an `<img>` body even on an error status. Loki dashboards keep counting real failures, and a `200` is the status every cache treats most aggressively. (The original reason given here was CloudFront's short error TTL. That was wrong about the CDN — see the corrected note above — but the decision stands on the reasons remaining.) |
| D2 | Placeholder responses send `Cache-Control: no-store`, never `setMediaCacheHeaders`. | Stops browser and CDN caching at the source, independent of D1. |
| D3 | `sendPlaceholder` never calls `saveToCache`. | Keeps the S3 `derived/` layer clean by construction, not by convention. |
| D4 | Triggers: missing original, processing failure, storage failure. | These three are what a user sees as a broken image. |
| D5 | The lock-wait `503` keeps its JSON body. | It means "another worker is building this right now". It clears in seconds and the client should retry, not paint a placeholder. |
| D6 | `416` range errors keep their JSON body. | A Range failure is a protocol error on a video, not a broken image. |
| D7 | Video: only `?target=snapshot` and `?target=webp` fall back to a placeholder. `full`, `preview`, `story`, `story-fallback` do not. | Those two targets produce still images. A `<video>` element cannot play a WebP, and an image body would break the `206` Range path. |
| D8 | The placeholder is an SVG built per request and rasterised by Sharp. | Vector geometry scales exactly. Sharp already reads SVG buffers in this project (`sharp.format.svg.input.buffer === true`). |
| D9 | Size: both sides given → use them. One side → square. Neither → 600×600. Each side clamped to 16…2000. | A square never looks wrong inside a CSS box that sets its own aspect ratio, and single-side requests here are mostly avatars. The clamp stops `w_99999` from exhausting memory. |
| D10 | No text in the placeholder. | Text needs a font inside the Alpine container, which Sharp's SVG renderer does not have, and it clips below about 200 px. |
| D11 | `handleVideo` receives the parsed URL params **for placeholder sizing only**. | Video delivery still ignores every transform param. Without this, every poster placeholder would be 600×600. |
| D12 | `saveToCache` gets its own try/catch in **both** `handleImage` and `handleVideo`. Log the failure, serve the real bytes. | Once a thrown error means "send a placeholder", a failed cache *write* would replace a good image with one. The transform already succeeded, so the real bytes must still go out. |
| D13 | If `renderPlaceholder` itself throws, `sendPlaceholder` logs and falls back to the original JSON error body at the same status. | The placeholder is a nicety. It must never turn a clean `404` into a `500`, and it must not depend on Sharp's SVG support being present at runtime. |
| D14 | `sendOriginal` is left unchanged. | Verified during implementation: `handleImage` sets `params.f` before its `Object.keys(params).length === 0` test, so that branch is dead. `sendOriginal` is reachable **only** from the non-inline-safe extension branch, which by definition excludes every image extension. A placeholder branch there would be unreachable code. |
| D15 | `handleRequest` wraps both handlers in an outer catch that sends a `500` placeholder, gated on `isPlaceholderImageExtension(filePath)` for images and on `PLACEHOLDER_VIDEO_TARGETS` for video. | Verified during implementation: the first `checkCache` and `acquireLock` calls sit **outside** `handleImage`'s `try`, so an S3 or Redis outage escaped to Fastify's 500 JSON. This net closes every remaining infra path in one place. It labels the reason `storage-error`, because every path it catches is infrastructure, not Sharp. |

## Design

### Module: `src/services/placeholderImage.js`

One purpose: turn a requested size into placeholder image bytes. It knows
nothing about routes, S3, or errors.

```js
resolvePlaceholderSize(params)                        // {w,h} -> {width,height}
buildPlaceholderSvg(width, height)                    // -> SVG string
renderPlaceholder({ width, height, format, quality }) // -> {buffer, contentType}
```

**Geometry.** A flat panel, then a 24×24-unit glyph placed by a single
`translate`/`scale` transform. The geometry is written once and scales exactly.

```
iconSize = min( max(0.34 * shorterSide, 24), 0.8 * shorterSide, 320 )

  16 px  -> 12.8   the 0.8 cap wins, the glyph still fits
  40 px  -> 24     the floor wins, the glyph stays legible
 120 px  -> 40.8   the plain 34% rule
 900 px  -> 306    34%, under the 320 ceiling
```

**Encoding.** The SVG buffer goes to the existing `processImage(svg, { f, q })`
with **no** `w`/`h`. Sharp rasterises at the size declared on the SVG element,
and format choice stays in one place. WebP for browsers, JPEG for social
crawlers, PNG for SVG sources — the same `resolveDefaultImageFormat` rule the
real path uses.

**Cost.** A process-local `Map` keyed by `width×height:format:quality`, capped
at 32 entries, oldest evicted first. A render is a few milliseconds; the map
makes a repeated broken URL near-free. Process memory only, never S3.

**Environment overrides.** `PLACEHOLDER_BG`, `PLACEHOLDER_FG`,
`PLACEHOLDER_DEFAULT_SIZE`, `PLACEHOLDER_MAX_SIZE`, `PLACEHOLDER_CACHE_CONTROL`.
Every one has a working default, so no `.env` change is required.

### Route helper: `sendPlaceholder`

Lives in `src/api/transform.js` next to the other response helpers.

```js
sendPlaceholder(request, reply, {
  statusCode, filePath, params, reason, isVideo, videoTarget,
})
```

It renders the image, then sets:

- `Content-Type` from the render
- `Cache-Control: no-store` (D2)
- `X-Placeholder: 1` and `X-Placeholder-Reason: not-found | storage-error | process-error`
- `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`,
  `Content-Disposition: inline` — the same headers the real image path sets
- `X-Cache` unchanged from the failing path (`NOT_FOUND` or `ERROR`)

It stamps `request._logExtra` with `placeholder: "yes"` so Loki can count
placeholder responses, then sends the buffer with `statusCode`.

### Call sites

| Call site | Line | Change |
|---|---|---|
| `handleImage`, S3 404 | 465-472 | `404` + placeholder, `reason=not-found` |
| `handleImage`, S3 fault | 473-487 | `500` + placeholder, `reason=storage-error`; keep the existing error log |
| `handleImage`, outer catch | 506-517 | `500` + placeholder, `reason=process-error` |
| `handleImage`, `saveToCache` | 498 | own try/catch, log and continue (D12) |
| `sendOriginal`, 404 and faults | 893-902 | placeholder for image extensions only (D14); everything else keeps JSON |
| `handleVideo`, poster 404 | 753-762 | `404` + placeholder, `snapshot`/`webp` only |
| `handleVideo`, poster fault | 763-778 | `500` + placeholder, `snapshot`/`webp` only |
| `handleVideo`, `saveToCache` | 808 | own try/catch, log and continue (D12) |
| `handleVideo`, outer catch | 855-870 | placeholder for poster targets; byte targets rethrow unchanged |
| `serveFromCacheOrWait` 503 | 282 | unchanged (D5) |
| every `416` | 229, 585, 661, 707, 816 | unchanged (D6) |
| `handleRequest` | 373 | pass `params` into `handleVideo` (D11) |

### Recovery flow

When the real image comes back, nothing needs purging:

1. The failing request wrote no `derived/` object (D3).
2. The browser and the CDN hold nothing, because of `no-store` (D2) plus the
   Cloudflare cache rules resolving `edge_ttl` to `respect_origin` (D1).
3. The next request is a normal cache `MISS`, transforms, and calls
   `saveToCache`. From then on it is a `HIT`.

## Out of scope

- Any change to the lock-wait `503` or to Range/`416` handling.
- Any change to `saveToCache`, `checkCache`, or the derived key scheme.
- A per-folder or per-tenant custom placeholder image.
- Video byte targets (`full`, `preview`, `story`, `story-fallback`).
- Uploading a static placeholder object to S3. The image is generated in
  process, so there is nothing to deploy or keep in sync.

## Verification

There is no test runner in this repository, so verification is a script plus
live checks.

1. `scripts/check-placeholder.js` renders at 16, 40, 120, 600, 2000 and
   1600×900, asserts the exact output dimensions, and writes PNGs to a temp
   folder so the scaling can be seen.
2. `GET /image/upload/w_300,h_200/does-not-exist.jpg` returns `404`,
   `Content-Type: image/webp`, a 300×200 image, `Cache-Control: no-store`,
   `X-Placeholder: 1`.
3. A valid URL that previously returned a placeholder returns `X-Cache: MISS`
   then `HIT`, and the storage bucket holds no `derived/` object written by the
   failing request.
4. Regression: a normal transform still returns `immutable`; a video
   `?target=full` still answers a Range request with `206`.
5. **Open, not yet verified:** the `ramaaz.dev` zone carries
   `browser_cache_ttl = 14400` as a dashboard setting, unmanaged by Terraform.
   Confirm it does not rewrite the placeholder's `no-store` for browsers:
   `curl -sI https://media.ramaaz.dev/image/upload/w_300,h_200/definitely-not-here.jpg`
   must show `cache-control: no-store` and a `cf-cache-status` that is not
   `HIT`/`MISS`. If it rewrites the header, set Browser Cache TTL to
   "Respect Existing Headers".
