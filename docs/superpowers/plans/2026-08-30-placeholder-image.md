# Placeholder Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the delivery route cannot produce an image, send a size-matched placeholder image instead of a JSON error body, without letting that placeholder be cached anywhere.

**Architecture:** A new service builds an SVG at the requested size and hands it to the existing `processImage` for rasterising. A single route helper, `sendPlaceholder`, replaces the JSON error bodies at seven call sites in `src/api/transform.js`. The placeholder keeps the real HTTP status (`404` / `500`), sends `Cache-Control: no-store`, and never calls `saveToCache` — so no cache layer can hold it.

**Tech Stack:** Node.js, Fastify 5, Sharp 0.35 (SVG input, WebP/JPEG/PNG/AVIF output), S3-compatible storage. No test runner, no linter, no formatter in this repository.

**Spec:** `docs/superpowers/specs/2026-08-30-placeholder-image-design.md`

**Branch:** `main` — no ticket branch. This is not an Engineering Workflow v1 ticket.

## Global Constraints

- **Never call `saveToCache` on a placeholder path.** This is the whole point of the change. The S3 `derived/` layer stays clean by construction (D3).
- **Never call `setMediaCacheHeaders` on a placeholder response.** Placeholders send `Cache-Control: no-store` (D2). `setMediaCacheHeaders` sends `max-age=31536000, immutable`, which would pin the placeholder for a year.
- **Keep the real status code.** `404` stays `404`, `500` stays `500`. Only the body changes (D1).
- **Do not touch these paths:** the lock-wait `503` at `transform.js:282` (D5); every `416` range response at lines 229, 585, 661, 707, 816 (D6); video byte targets `full`, `preview`, `story`, `story-fallback` (D7).
- **Size clamp:** every placeholder side is clamped to `16 … 2000` px (D9).
- **No text in the placeholder** — no font is available in the Alpine container (D10).
- **There is no test runner.** Verification is `node` scripts using the built-in `node:assert/strict`, run directly with `node`. Do not add Jest, Vitest, or any test dependency.
- **Env vars must all have working defaults.** No `.env` file change may be required to deploy this.
- **File style:** CommonJS (`require` / `module.exports`), 2-space indent, double-quoted strings — match the surrounding files.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/services/placeholderImage.js` | **Create.** Size resolution, SVG geometry, rasterising, in-process render cache. Knows nothing about routes, S3, or errors. |
| `src/scripts/check-placeholder.js` | **Create.** Standalone verification script for the module. Asserts sizes, writes sample PNGs for visual inspection. |
| `src/api/transform.js` | **Modify.** Add `sendPlaceholder`; swap seven JSON error bodies for it; isolate two `saveToCache` calls; pass `params` into `handleVideo`. |
| `package.json` | **Modify.** Add the `check:placeholder` script. |
| `README.md` | **Modify.** Document the placeholder behaviour and its five env vars. |

---

## Task 1: The placeholder image service

**Files:**
- Create: `src/services/placeholderImage.js`
- Create: `src/scripts/check-placeholder.js`
- Modify: `package.json:6-15` (scripts block)

**Interfaces:**
- Consumes: `processImage(inputBuffer, params)` from `src/processors/imageProcessor.js`, which returns `{ buffer, contentType }`.
- Produces, for Tasks 2 to 4:
  - `resolvePlaceholderSize(params)` → `{ width: number, height: number }`. `params` is the parsed transform object, so `params.w` and `params.h` are numbers or absent.
  - `renderPlaceholder({ width, height, format, quality })` → `Promise<{ buffer: Buffer, contentType: string }>`. `format` is one of `webp jpeg jpg png avif`; anything else falls back to `webp`. `quality` is a number or `undefined`.
  - `buildPlaceholderSvg(width, height)` → `string`. Exported for the check script only.

- [ ] **Step 1: Write the failing check script**

Create `src/scripts/check-placeholder.js`:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const {
  resolvePlaceholderSize,
  buildPlaceholderSvg,
  renderPlaceholder,
} = require("../services/placeholderImage");

const outDir = path.join(os.tmpdir(), "placeholder-check");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // ── Sizing rules (design D9) ────────────────────────────────────────
  assert.deepEqual(resolvePlaceholderSize({ w: 400, h: 200 }), {
    width: 400,
    height: 200,
  });
  assert.deepEqual(resolvePlaceholderSize({ w: 400 }), {
    width: 400,
    height: 400,
  });
  assert.deepEqual(resolvePlaceholderSize({ h: 300 }), {
    width: 300,
    height: 300,
  });
  assert.deepEqual(resolvePlaceholderSize({}), { width: 600, height: 600 });
  assert.deepEqual(resolvePlaceholderSize({ w: 99999 }), {
    width: 2000,
    height: 2000,
  });
  assert.deepEqual(resolvePlaceholderSize({ w: 2 }), { width: 16, height: 16 });
  assert.deepEqual(resolvePlaceholderSize({ w: -5, h: 0 }), {
    width: 600,
    height: 600,
  });
  console.log("ok  sizing rules");

  // ── The glyph never overflows its panel ─────────────────────────────
  for (const [w, h] of [
    [16, 16],
    [40, 40],
    [120, 120],
    [600, 600],
    [1600, 900],
    [2000, 2000],
  ]) {
    const svg = buildPlaceholderSvg(w, h);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.includes(`width="${w}"`), `svg declares width ${w}`);
    assert.ok(svg.includes(`height="${h}"`), `svg declares height ${h}`);

    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    const iconSize = scale * 24;
    assert.ok(
      iconSize <= Math.min(w, h) * 0.8 + 0.01,
      `icon ${iconSize} fits inside ${w}x${h}`,
    );
    assert.ok(iconSize > 0, "icon has a positive size");
  }
  console.log("ok  glyph geometry");

  // ── Rendering produces the exact requested pixel size ───────────────
  for (const [w, h] of [
    [16, 16],
    [40, 40],
    [120, 120],
    [600, 600],
    [1600, 900],
    [2000, 2000],
  ]) {
    const { buffer, contentType } = await renderPlaceholder({
      width: w,
      height: h,
      format: "png",
    });
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.width, w, `rendered width for ${w}x${h}`);
    assert.equal(meta.height, h, `rendered height for ${w}x${h}`);
    assert.equal(contentType, "image/png");
    fs.writeFileSync(path.join(outDir, `placeholder-${w}x${h}.png`), buffer);
  }
  console.log("ok  render dimensions");

  // ── Format handling ─────────────────────────────────────────────────
  const webp = await renderPlaceholder({ width: 300, height: 200 });
  assert.equal(webp.contentType, "image/webp", "defaults to webp");

  const jpeg = await renderPlaceholder({
    width: 300,
    height: 200,
    format: "jpg",
  });
  assert.equal(jpeg.contentType, "image/jpeg", "jpg maps to image/jpeg");

  const bogus = await renderPlaceholder({
    width: 300,
    height: 200,
    format: "svg",
  });
  assert.equal(bogus.contentType, "image/webp", "svg falls back to webp");
  console.log("ok  format handling");

  // ── The render cache returns the same buffer, and stays bounded ─────
  const a = await renderPlaceholder({ width: 321, height: 123, format: "png" });
  const b = await renderPlaceholder({ width: 321, height: 123, format: "png" });
  assert.equal(a.buffer, b.buffer, "second call is served from the cache");

  for (let i = 0; i < 60; i += 1) {
    await renderPlaceholder({ width: 100 + i, height: 100, format: "png" });
  }
  console.log("ok  render cache");

  console.log(`\nAll placeholder checks passed. Samples in: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node src/scripts/check-placeholder.js
```

Expected: `Error: Cannot find module '../services/placeholderImage'`.

- [ ] **Step 3: Write the module**

Create `src/services/placeholderImage.js`:

```js
const { processImage } = require("../processors/imageProcessor");

const MIN_SIDE = 16;

// Formats we are willing to emit. `svg` is deliberately absent: the placeholder
// must never be served back as markup, and the transform route already forces
// PNG for SVG sources.
const PLACEHOLDER_FORMATS = new Set(["webp", "jpeg", "jpg", "png", "avif"]);

// Renders are a few milliseconds each, but a broken URL is usually requested
// many times in a row. This map is process memory only — never S3.
const RENDER_CACHE_LIMIT = 32;
const renderCache = new Map();

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxSide() {
  return envInt("PLACEHOLDER_MAX_SIZE", 2000);
}

function defaultSide() {
  return envInt("PLACEHOLDER_DEFAULT_SIZE", 600);
}

function clampSide(value) {
  return Math.min(Math.max(Math.round(value), MIN_SIDE), maxSide());
}

function toSide(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Decide the placeholder size from the requested transform params.
 *
 * Both sides given -> use them. One side -> square, because a square never
 * looks wrong inside a CSS box that sets its own aspect ratio. Neither ->
 * the default. Every side is clamped so `w_99999` cannot exhaust memory.
 */
function resolvePlaceholderSize(params = {}) {
  const width = toSide(params?.w);
  const height = toSide(params?.h);

  if (width && height) {
    return { width: clampSide(width), height: clampSide(height) };
  }
  if (width) return { width: clampSide(width), height: clampSide(width) };
  if (height) return { width: clampSide(height), height: clampSide(height) };

  const side = clampSide(defaultSide());
  return { width: side, height: side };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Build the placeholder as SVG so one piece of geometry covers every size.
 *
 * The glyph is drawn in a 24x24 unit box and placed with a single
 * translate/scale, so it stays centred and proportional from a 16 px avatar
 * to a 2000 px hero. The three bounds below, in order: 34% of the shorter
 * side is the look we want; the 24 px floor keeps it legible when tiny; the
 * 0.8 ceiling stops the floor from overflowing the panel; 320 px stops it
 * from dominating a very large image.
 */
function buildPlaceholderSvg(width, height) {
  const background = process.env.PLACEHOLDER_BG || "#EDEEF0";
  const foreground = process.env.PLACEHOLDER_FG || "#B4B9C2";

  const shorter = Math.min(width, height);
  const iconSize = Math.min(
    Math.max(0.34 * shorter, 24),
    0.8 * shorter,
    320,
  );
  const scale = round(iconSize / 24);
  const offsetX = round((width - iconSize) / 2);
  const offsetY = round((height - iconSize) / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${background}"/>
<g transform="translate(${offsetX} ${offsetY}) scale(${scale})" fill="none" stroke="${foreground}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
<rect x="1.6" y="3.6" width="20.8" height="16.8" rx="2.4"/>
<circle cx="8.2" cy="9.4" r="1.9"/>
<path d="M2.4 16.6 L8.1 11.2 L13.2 15.7 L16.4 12.9 L21.6 17.6"/>
</g>
</svg>`;
}

/**
 * Rasterise the placeholder at an exact pixel size.
 *
 * `processImage` is given no `w`/`h`, so Sharp renders the SVG at the size
 * declared on the element and does not resample afterwards. Format and
 * quality handling therefore stay in one place.
 */
async function renderPlaceholder({ width, height, format, quality }) {
  const outputFormat = PLACEHOLDER_FORMATS.has(format) ? format : "webp";
  const cacheKey = `${width}x${height}:${outputFormat}:${quality ?? ""}`;

  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  const svg = Buffer.from(buildPlaceholderSvg(width, height));
  const rendered = await processImage(svg, {
    f: outputFormat,
    ...(typeof quality === "number" ? { q: quality } : {}),
  });

  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    renderCache.delete(renderCache.keys().next().value);
  }
  renderCache.set(cacheKey, rendered);

  return rendered;
}

module.exports = {
  resolvePlaceholderSize,
  buildPlaceholderSvg,
  renderPlaceholder,
};
```

- [ ] **Step 4: Run the check script to verify it passes**

```bash
node src/scripts/check-placeholder.js
```

Expected: five `ok` lines, then `All placeholder checks passed. Samples in: <temp dir>`.

If it fails with an SVG-related Sharp error, stop and report — the installed Sharp build lacks librsvg, and the whole design depends on it.

- [ ] **Step 5: Look at the sample images**

Open the PNGs the script wrote to the temp folder it printed. Confirm by eye that the glyph is centred, has similar visual weight at 40 px and at 1600×900, and does not touch the panel edge at 16 px.

- [ ] **Step 6: Add the npm script**

In `package.json`, inside the `"scripts"` block, after the `"worker"` line (add a comma to the `"worker"` line):

```json
    "worker": "cross-env NODE_ENV=production node src/worker.js",
    "check:placeholder": "node src/scripts/check-placeholder.js"
```

- [ ] **Step 7: Run it through npm**

```bash
npm run check:placeholder
```

Expected: same passing output as Step 4.

- [ ] **Step 8: Commit**

```bash
git add src/services/placeholderImage.js src/scripts/check-placeholder.js package.json
git commit -m "feat(placeholder): add dynamic placeholder image service

Builds an SVG at the requested size and rasterises it with Sharp, so one
piece of geometry covers every image size from a 16px avatar to a 2000px
hero. Sides are clamped to 16..2000 so a huge w_ value cannot exhaust
memory. Includes a standalone check script; there is no test runner here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `sendPlaceholder` helper and the image call sites

**Files:**
- Modify: `src/api/transform.js` — imports, new helper, `handleImage` (lines 389-520)

**Interfaces:**
- Consumes from Task 1: `resolvePlaceholderSize(params)`, `renderPlaceholder({ width, height, format, quality })`.
- Consumes, already in the file: `resolveDefaultImageFormat(request)` (line 87), `setImageDeliveryHeaders(reply, contentType)` (line 65), `stampLogExtra(request, opts)` (line 285), `VALID_IMAGE_FORMATS` (imported at line 7).
- Produces, for Tasks 3 and 4:
  - `PLACEHOLDER_REASONS` → `{ NOT_FOUND: "not-found", STORAGE: "storage-error", PROCESS: "process-error" }`
  - `sendPlaceholder(request, reply, { statusCode, filePath, params, reason, fallbackError, isVideo, videoTarget })` → `Promise<reply>`. `params` may be `{}`. `fallbackError` is the JSON message to use if the render itself fails. `isVideo` defaults to `false`.

- [ ] **Step 1: Add the import**

In `src/api/transform.js`, after the `videoQueue` require at line 43, add:

```js
const {
  resolvePlaceholderSize,
  renderPlaceholder,
} = require("../services/placeholderImage");
```

- [ ] **Step 2: Add the reason constants and the extension allowlist**

After `setMediaCacheHeaders` / `setPendingCacheHeaders` (that is, after line 58, before the `setImageDeliveryHeaders` comment block), add:

```js
const PLACEHOLDER_REASONS = {
  NOT_FOUND: "not-found",
  STORAGE: "storage-error",
  PROCESS: "process-error",
};

// Only still-image sources get a placeholder. `isInlineSafeExtension` also
// admits mp4/mov/webm, and an image body in place of a missing video would be
// wrong (design D14).
const PLACEHOLDER_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
]);

// Video targets that produce a still frame. Byte targets keep their JSON
// errors: a <video> element cannot play a WebP (design D7).
const PLACEHOLDER_VIDEO_TARGETS = new Set(["snapshot", "webp"]);

function isPlaceholderImageExtension(filePath) {
  const extension = String(filePath || "").split(".").pop();
  if (!extension) return false;
  return PLACEHOLDER_IMAGE_EXTENSIONS.has(extension.toLowerCase());
}
```

- [ ] **Step 3: Add the `sendPlaceholder` helper**

`sendPlaceholder` calls `stampLogExtra` and `resolveDefaultImageFormat`, so put it immediately **after** `stampLogExtra` ends (after line 312, before `async function transformRoutes`):

```js
/**
 * Send a size-matched placeholder image in place of a JSON error body.
 *
 * The response keeps its real status code, so a browser still renders the
 * body inside an <img> while CloudFront files it under the short error TTL
 * rather than the aggressive 200 path. It sends `no-store` and never calls
 * `saveToCache`, so no layer can hold the placeholder once the real image
 * comes back (design D1, D2, D3).
 */
async function sendPlaceholder(
  request,
  reply,
  {
    statusCode,
    filePath,
    params,
    reason,
    fallbackError,
    isVideo = false,
    videoTarget,
  },
) {
  const cacheStatus =
    reason === PLACEHOLDER_REASONS.NOT_FOUND ? "NOT_FOUND" : "ERROR";

  stampLogExtra(request, { isVideo, filePath, cacheStatus, videoTarget });
  request._logExtra.placeholder = "yes";
  request._logExtra.placeholder_reason = reason;

  try {
    const { width, height } = resolvePlaceholderSize(params);
    const requestedFormat =
      typeof params?.f === "string" &&
      VALID_IMAGE_FORMATS.has(params.f) &&
      params.f !== "svg"
        ? params.f
        : resolveDefaultImageFormat(request);

    const { buffer, contentType } = await renderPlaceholder({
      width,
      height,
      format: requestedFormat,
      quality: typeof params?.q === "number" ? params.q : undefined,
    });

    reply.header("Content-Type", contentType);
    reply.header(
      "Cache-Control",
      process.env.PLACEHOLDER_CACHE_CONTROL || "no-store",
    );
    setImageDeliveryHeaders(reply);
    reply.header("X-Placeholder", "1");
    reply.header("X-Placeholder-Reason", reason);
    reply.header("X-Cache", cacheStatus);
    if (isVideo && videoTarget != null) {
      reply.header("X-Video-Target", videoTarget);
    }

    return reply.code(statusCode).send(buffer);
  } catch (err) {
    // The placeholder is a nicety. It must never turn a clean 404 into a 500,
    // so fall back to the JSON body this call site used to send (design D13).
    request.log?.error(
      {
        service: "media-serving",
        component: "TransformRoute",
        env: process.env.NODE_ENV,
        request_id: request.id,
        file_path: filePath,
        exception: err.constructor?.name || "Error",
        error_message: err.message,
      },
      "Placeholder render failed, falling back to JSON error",
    );
    request._logExtra.placeholder = "failed";
    return reply.code(statusCode).send({ error: fallbackError });
  }
}
```

- [ ] **Step 4: Replace the `handleImage` S3 404 and fault branches**

In `handleImage`, replace the whole `catch (err)` block that starts at line 464 and ends at line 487 (it currently ends with `throw err;` just before the closing brace of the catch). The block to replace begins `} catch (err) {` and contains `"Failed to fetch original from S3"`. Replace it with:

```js
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
          return sendPlaceholder(request, reply, {
            statusCode: 404,
            filePath,
            params,
            reason: PLACEHOLDER_REASONS.NOT_FOUND,
            fallbackError: "Original file not found",
          });
        }
        log?.error(
          {
            service: "media-serving",
            component: "TransformRoute",
            env: process.env.NODE_ENV,
            file_path: filePath,
            exception: err.constructor?.name || "Error",
            error_message: err.message,
          },
          "Failed to fetch original from S3",
        );
        return sendPlaceholder(request, reply, {
          statusCode: 500,
          filePath,
          params,
          reason: PLACEHOLDER_REASONS.STORAGE,
          fallbackError: "Internal server error",
        });
      }
```

- [ ] **Step 5: Isolate the `saveToCache` call**

Still in `handleImage`, replace line 498:

```js
      await saveToCache(derivedKey, buffer, contentType);
```

with:

```js
      // A failed cache *write* must not cost the caller their image: the
      // transform already succeeded, and the outer catch now sends a
      // placeholder (design D12).
      try {
        await saveToCache(derivedKey, buffer, contentType);
      } catch (cacheErr) {
        log?.error(
          {
            service: "media-serving",
            component: "TransformRoute",
            env: process.env.NODE_ENV,
            file_path: filePath,
            derived_key: derivedKey,
            exception: cacheErr.constructor?.name || "Error",
            error_message: cacheErr.message,
          },
          "Failed to write derived object to cache, serving uncached",
        );
      }
```

- [ ] **Step 6: Replace the `handleImage` outer catch**

Replace the outer `catch (err)` block that starts at line 506 (the one whose comment reads `Catch-all for processImage / saveToCache / unexpected failures.`) with:

```js
    } catch (err) {
      // Catch-all for processImage / unexpected failures. saveToCache has its
      // own handler above, so reaching here means no valid image exists.
      log?.error(
        {
          service: "media-serving",
          component: "TransformRoute",
          env: process.env.NODE_ENV,
          file_path: filePath,
          exception: err.constructor?.name || "Error",
          error_message: err.message,
        },
        "Image processing failed",
      );
      return sendPlaceholder(request, reply, {
        statusCode: 500,
        filePath,
        params,
        reason: PLACEHOLDER_REASONS.PROCESS,
        fallbackError: "Internal server error",
      });
    } finally {
      await releaseLock(derivedKey);
    }
```

Note: the `finally` block is unchanged, but it is shown so the replacement region is unambiguous. The lock still releases on every path.

- [ ] **Step 7: Start the server and check the 404 path**

```bash
npm run dev
```

In a second terminal:

```bash
curl -i "http://localhost:3000/image/upload/w_300,h_200/no-such-file.jpg" -o /tmp/ph.webp -D -
```

Expected headers: `HTTP/1.1 404 Not Found`, `content-type: image/webp`, `cache-control: no-store`, `x-placeholder: 1`, `x-placeholder-reason: not-found`, `x-cache: NOT_FOUND`. No `immutable` anywhere.

- [ ] **Step 8: Check the rendered size and that nothing was cached**

```bash
node -e "require('sharp')('/tmp/ph.webp').metadata().then(m=>console.log(m.width,m.height,m.format))"
```

Expected: `300 200 webp`.

Then confirm the failing request wrote nothing to storage. With the local MinIO stack running:

```bash
docker compose exec minio mc ls --recursive local/<your-bucket>/derived/ | wc -l
```

Run it before and after the curl. Expected: the count does not change.

- [ ] **Step 9: Check a healthy transform is untouched**

```bash
curl -sI "http://localhost:3000/image/upload/w_300,h_200/<a-real-file>.jpg" | grep -i "cache-control\|x-cache\|x-placeholder"
```

Expected: `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`, `x-cache: MISS` (then `HIT` on a second call), and **no** `x-placeholder` header.

- [ ] **Step 10: Commit**

```bash
git add src/api/transform.js
git commit -m "feat(transform): serve a placeholder image on image failures

Missing originals, S3 faults and Sharp failures now return a size-matched
placeholder image instead of a JSON body. The response keeps its real
status code and sends no-store, and never calls saveToCache, so no cache
layer holds the placeholder once the real image is back.

Also isolates saveToCache so a failed cache write no longer replaces a
good image with a placeholder.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Outer safety net in `handleRequest`

> **Revised during implementation.** This task originally patched `sendOriginal`.
> Two facts found by the Task 2 checks changed it:
>
> 1. **The original Task 3 was dead code.** `handleImage` sets `params.f` before
>    its `Object.keys(params).length === 0` test, so that `sendOriginal` branch
>    never fires. `sendOriginal` is reachable only from the non-inline-safe
>    extension branch, which by definition excludes every image extension. So
>    `sendOriginal` is left unchanged (design D14).
> 2. **A real gap was open.** The first `checkCache(derivedKey)` and
>    `acquireLock` calls sit **outside** `handleImage`'s `try`. An S3 or Redis
>    outage threw there and escaped to Fastify's `500` JSON, so design D4's
>    "storage failure" case was only half covered. One outer catch in
>    `handleRequest` closes every remaining infra path (design D15).

**Files:**
- Modify: `src/api/transform.js` — the `isVideo` branch at the end of `handleRequest`

**Interfaces:**
- Consumes from Task 2: `sendPlaceholder`, `PLACEHOLDER_REASONS`, `PLACEHOLDER_VIDEO_TARGETS`, `isPlaceholderImageExtension`. Also `resolveVideoTarget(request)`, already at line 225.
- Produces: nothing new.

- [ ] **Step 1: Wrap both handler calls**

Replace the closing `if (isVideo) { ... } else { ... }` block of `handleRequest` with:

```js
    try {
      if (isVideo) {
        // VIDEO: ignore all URL transform params, only use ?target= query param
        await handleVideo(request, reply, filePath, params);
      } else {
        await handleImage(request, reply, filePath, params, request.log);
      }
    } catch (err) {
      // Last line of defence. The handlers cover their own S3 fetch and
      // processing failures; what reaches here is infrastructure that failed
      // before or around them — the cache-existence probe, the lock, a range
      // metadata read (design D15).
      if (reply.sent === true || reply.raw.headersSent) throw err;

      const videoTarget = isVideo ? resolveVideoTarget(request) : undefined;
      const eligible = isVideo
        ? PLACEHOLDER_VIDEO_TARGETS.has(videoTarget)
        : isPlaceholderImageExtension(filePath);

      if (!eligible) throw err;

      request.log.error(
        {
          service: "media-serving",
          component: "TransformRoute",
          env: process.env.NODE_ENV,
          request_id: request.id,
          file_path: filePath,
          ...(isVideo && { video_target: videoTarget }),
          exception: err.constructor?.name || "Error",
          error_message: err.message,
        },
        "Media request failed before the handler could answer",
      );

      return sendPlaceholder(request, reply, {
        statusCode: 500,
        filePath,
        params,
        reason: PLACEHOLDER_REASONS.STORAGE,
        fallbackError: "Internal server error",
        isVideo,
        videoTarget,
      });
    }
```

Note this also delivers Task 4 Step 1 (passing `params` into `handleVideo`).

**Superseded — do not apply.** The original Step 1 replaced the `catch` block in `sendOriginal` with:

```js
    } catch (err) {
      const eligible = isPlaceholderImageExtension(filePath);

      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        if (!eligible) {
          stampLogExtra(request, {
            isVideo: false,
            filePath,
            cacheStatus: "NOT_FOUND",
          });
          return reply.code(404).send({ error: "Original file not found" });
        }
        return sendPlaceholder(request, reply, {
          statusCode: 404,
          filePath,
          params: {},
          reason: PLACEHOLDER_REASONS.NOT_FOUND,
          fallbackError: "Original file not found",
        });
      }

      request.log?.error(
        {
          service: "media-serving",
          component: "TransformRoute",
          env: process.env.NODE_ENV,
          request_id: request.id,
          file_path: filePath,
          exception: err.constructor?.name || "Error",
          error_message: err.message,
        },
        "Failed to fetch original from S3",
      );

      if (!eligible) {
        stampLogExtra(request, {
          isVideo: false,
          filePath,
          cacheStatus: "ERROR",
        });
        throw err;
      }

      return sendPlaceholder(request, reply, {
        statusCode: 500,
        filePath,
        params: {},
        reason: PLACEHOLDER_REASONS.STORAGE,
        fallbackError: "Internal server error",
      });
    }
```

`params: {}` is correct here — `sendOriginal` is only reached when there are no transform params, so the placeholder uses the 600×600 default.

- [ ] **Step 2: Check the no-params image path**

Restart `npm run dev`, then:

```bash
curl -si "http://localhost:3000/image/upload/no-such-file.png" -o /tmp/ph2.png -D - | grep -i "HTTP/\|x-placeholder\|cache-control"
node -e "require('sharp')('/tmp/ph2.png').metadata().then(m=>console.log(m.width,m.height))"
```

Expected: `404`, `x-placeholder: 1`, `cache-control: no-store`, and `600 600`.

- [ ] **Step 3: Check a non-image extension still returns JSON**

```bash
curl -si "http://localhost:3000/image/upload/no-such-file.pdf"
```

Expected: `404` with body `{"error":"Original file not found"}`, and **no** `x-placeholder` header.

- [ ] **Step 4: Commit**

```bash
git add src/api/transform.js
git commit -m "feat(transform): serve a placeholder from the sendOriginal path

Covers untransformed image URLs. Non-image extensions keep their JSON
error, because an image body in place of a missing PDF or video would be
wrong.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Video poster targets

**Files:**
- Modify: `src/api/transform.js:376` (`handleRequest` call), `:526` (`handleVideo` signature), `:753-778`, `:808`, `:855-870`

**Interfaces:**
- Consumes from Task 2: `sendPlaceholder`, `PLACEHOLDER_REASONS`, `PLACEHOLDER_VIDEO_TARGETS`.
- Produces: `handleVideo(request, reply, filePath, params)` — the fourth argument is used **only** to size a placeholder. Video delivery still ignores every transform param.

- [ ] **Step 1: Pass `params` into `handleVideo`**

At line 376, change:

```js
      await handleVideo(request, reply, filePath);
```

to:

```js
      // `params` is used only to size a placeholder if this request fails.
      // Video delivery still ignores every URL transform param.
      await handleVideo(request, reply, filePath, params);
```

At line 526, change the signature:

```js
  async function handleVideo(request, reply, filePath) {
```

to:

```js
  async function handleVideo(request, reply, filePath, params = {}) {
```

- [ ] **Step 2: Replace the poster fetch `catch` block**

Replace the `catch (err)` block at lines 753-778 — the one containing `"Failed to fetch video original from S3"` — with:

```js
      } catch (err) {
        const eligible = PLACEHOLDER_VIDEO_TARGETS.has(variantName);

        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
          if (!eligible) {
            stampLogExtra(request, {
              isVideo: true,
              filePath,
              cacheStatus: "NOT_FOUND",
              videoTarget: variantName,
            });
            return reply.code(404).send({ error: "Original file not found" });
          }
          return sendPlaceholder(request, reply, {
            statusCode: 404,
            filePath,
            params,
            reason: PLACEHOLDER_REASONS.NOT_FOUND,
            fallbackError: "Original file not found",
            isVideo: true,
            videoTarget: variantName,
          });
        }

        request.log.error(
          {
            service: "media-serving",
            component: "TransformRoute",
            env: process.env.NODE_ENV,
            request_id: request.id,
            file_path: filePath,
            video_target: variantName,
            exception: err.constructor?.name || "Error",
            error_message: err.message,
          },
          "Failed to fetch video original from S3",
        );

        if (!eligible) {
          stampLogExtra(request, {
            isVideo: true,
            filePath,
            cacheStatus: "ERROR",
            videoTarget: variantName,
          });
          throw err;
        }

        return sendPlaceholder(request, reply, {
          statusCode: 500,
          filePath,
          params,
          reason: PLACEHOLDER_REASONS.STORAGE,
          fallbackError: "Internal server error",
          isVideo: true,
          videoTarget: variantName,
        });
      }
```

In practice only `snapshot` and `webp` reach this code, because byte targets return earlier at the `VIDEO_BYTE_TARGETS` branch (line 632). The `eligible` check is there so the behaviour stays correct if that branch ever changes.

- [ ] **Step 3: Isolate the video `saveToCache` call**

Replace line 808:

```js
      await saveToCache(derivedKey, buffer, contentType);
```

with:

```js
      // Same reason as the image path: a failed cache write must not cost the
      // caller a poster that was produced successfully (design D12).
      try {
        await saveToCache(derivedKey, buffer, contentType);
      } catch (cacheErr) {
        request.log.error(
          {
            service: "media-serving",
            component: "TransformRoute",
            env: process.env.NODE_ENV,
            request_id: request.id,
            file_path: filePath,
            video_target: variantName,
            derived_key: derivedKey,
            exception: cacheErr.constructor?.name || "Error",
            error_message: cacheErr.message,
          },
          "Failed to write derived video object to cache, serving uncached",
        );
      }
```

- [ ] **Step 4: Replace the `handleVideo` outer catch**

Replace the outer `catch (err)` block starting at line 855 (comment `Catch-all for processVideo / saveToCache / unexpected failures.`) with:

```js
    } catch (err) {
      // Catch-all for processVideo / unexpected failures. saveToCache has its
      // own handler above.
      if (PLACEHOLDER_VIDEO_TARGETS.has(variantName)) {
        request.log.error(
          {
            service: "media-serving",
            component: "TransformRoute",
            env: process.env.NODE_ENV,
            request_id: request.id,
            file_path: filePath,
            video_target: variantName,
            exception: err.constructor?.name || "Error",
            error_message: err.message,
          },
          "Video poster processing failed",
        );
        return sendPlaceholder(request, reply, {
          statusCode: 500,
          filePath,
          params,
          reason: PLACEHOLDER_REASONS.PROCESS,
          fallbackError: "Internal server error",
          isVideo: true,
          videoTarget: variantName,
        });
      }

      // If stampLogExtra was already called (e.g. for a handled 404), keep it.
      if (!request._logExtra) {
        stampLogExtra(request, {
          isVideo: true,
          filePath,
          cacheStatus: "ERROR",
          videoTarget: variantName,
        });
      }
      throw err;
    } finally {
      await releaseLock(derivedKey);
    }
```

The `finally` block is unchanged, shown so the replacement region is unambiguous.

- [ ] **Step 5: Check a missing video poster**

Restart `npm run dev`, then:

```bash
curl -si "http://localhost:3000/video/upload/w_320,h_180/no-such-video.mp4?target=webp" -o /tmp/ph3.webp -D - | grep -i "HTTP/\|x-placeholder\|x-video-target\|cache-control"
node -e "require('sharp')('/tmp/ph3.webp').metadata().then(m=>console.log(m.width,m.height))"
```

Expected: `404`, `x-placeholder: 1`, `x-video-target: webp`, `cache-control: no-store`, and `320 180`.

- [ ] **Step 6: Check `target=snapshot` too**

```bash
curl -si "http://localhost:3000/video/upload/no-such-video.mp4?target=snapshot" | grep -i "HTTP/\|x-placeholder"
```

Expected: `404` and `x-placeholder: 1`. Size will be the 600×600 default, since no `w`/`h` was given.

- [ ] **Step 7: Check that byte targets are unchanged**

```bash
curl -si "http://localhost:3000/video/upload/no-such-video.mp4?target=full"
curl -si "http://localhost:3000/video/upload/no-such-video.mp4?target=preview"
```

Expected for both: `404` with body `{"error":"Original file not found"}` and **no** `x-placeholder` header.

- [ ] **Step 8: Check a real video still streams with Range**

```bash
curl -si -H "Range: bytes=0-1023" "http://localhost:3000/video/upload/<a-real-video>.mp4?target=full" | head -12
```

Expected: `HTTP/1.1 206 Partial Content`, a `Content-Range` header, `accept-ranges: bytes`. No `x-placeholder`.

- [ ] **Step 9: Commit**

```bash
git add src/api/transform.js
git commit -m "feat(transform): serve a placeholder for video poster targets

target=snapshot and target=webp fall back to a placeholder image. Byte
targets (full, preview, story, story-fallback) keep their JSON errors,
because a <video> element cannot play a WebP and an image body would
break the 206 Range path.

handleVideo now receives the parsed params, used only to size the
placeholder; video delivery still ignores every URL transform param.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full-flow cache proof and documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.
- Produces: nothing new.

This task proves the change actually solves the stated problem — a placeholder must not survive once the real image is back.

- [ ] **Step 1: Prove the recovery flow end to end**

With `npm run dev` running and MinIO up:

1. Request a transform for a file that does **not** exist yet:
   ```bash
   curl -sI "http://localhost:3000/image/upload/w_400,h_400/recovery-test.jpg" | grep -i "HTTP/\|x-placeholder\|x-cache"
   ```
   Expected: `404`, `x-placeholder: 1`, `x-cache: NOT_FOUND`.

2. Confirm nothing was written:
   ```bash
   docker compose exec minio mc ls --recursive local/<your-bucket>/derived/ | wc -l
   ```
   Note the number.

3. Upload the real file to that exact path (through `POST /upload` with your `X-API-Key`, using `folder` so it lands at `originals/recovery-test.jpg`).

4. Request the same URL again:
   ```bash
   curl -sI "http://localhost:3000/image/upload/w_400,h_400/recovery-test.jpg" | grep -i "HTTP/\|x-placeholder\|x-cache\|cache-control"
   ```
   Expected: `200`, **no** `x-placeholder`, `x-cache: MISS`, `cache-control: ... immutable`.

5. Request it once more. Expected: `x-cache: HIT`.

6. Confirm exactly one new object appeared under `derived/`.

If step 4 still returns a placeholder, the change has failed its main purpose — stop and report.

- [ ] **Step 2: Check the log line carries the placeholder field**

In the `npm run dev` terminal, find the log line for the step-1 request. It must contain `"placeholder":"yes"`, `"placeholder_reason":"not-found"`, `"component":"TransformRoute"`, and `"transformed":"bypass"`.

`transformed: "bypass"` is correct and intended: `stampLogExtra` maps anything that is not `HIT`/`MISS`/`PENDING` to `bypass`, which keeps placeholder responses out of the Loki warm/cold cache-ratio queries.

- [ ] **Step 3: Re-run the module checks**

```bash
npm run check:placeholder
```

Expected: all checks pass. Nothing in Tasks 2 to 4 should have changed the module.

- [ ] **Step 4: Document the behaviour in the README**

Add this section to `README.md`, after the section that describes the delivery route (`GET /:resourceType/upload/*`):

```markdown
### Placeholder images on failure

When the delivery route cannot produce an image, it sends a generated
placeholder image instead of a JSON error body. The placeholder matches the
requested size, so it fits the layout it was going to fill.

**When it is used**

| Case | Status | `X-Placeholder-Reason` |
|---|---|---|
| Original missing in S3 | `404` | `not-found` |
| S3 unreachable or returning 5xx | `500` | `storage-error` |
| Sharp or FFmpeg failed on the original | `500` | `process-error` |

Video: only `?target=snapshot` and `?target=webp` fall back to a placeholder.
`full`, `preview`, `story` and `story-fallback` keep their JSON errors, because
a `<video>` element cannot play a WebP. The lock-wait `503` and all `416` range
errors also keep their JSON bodies.

**It is never cached.** A placeholder response keeps its real status code,
sends `Cache-Control: no-store`, and is never written to the S3 `derived/`
cache. So the moment the real image is available, the next request transforms
it normally and caches that instead. Nothing needs purging.

Placeholder responses carry `X-Placeholder: 1`, and their log line carries
`placeholder: "yes"` for Loki queries.

**Size:** both `w` and `h` given uses them; one side gives a square; neither
gives 600x600. Each side is clamped to 16-2000 px.

**Environment variables** (every one is optional):

| Variable | Default | Meaning |
|---|---|---|
| `PLACEHOLDER_BG` | `#EDEEF0` | Panel colour |
| `PLACEHOLDER_FG` | `#B4B9C2` | Glyph colour |
| `PLACEHOLDER_DEFAULT_SIZE` | `600` | Side used when no `w`/`h` is given |
| `PLACEHOLDER_MAX_SIZE` | `2000` | Upper clamp on either side |
| `PLACEHOLDER_CACHE_CONTROL` | `no-store` | Cache header on placeholder responses |

Run `npm run check:placeholder` to render samples at several sizes into a temp
folder and assert the output dimensions.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe the placeholder image behaviour and its env vars

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| D1 real status code | Task 2 Step 3 (`reply.code(statusCode)`) |
| D2 `no-store` | Task 2 Step 3 |
| D3 never `saveToCache` | Task 2 Step 3 — `sendPlaceholder` contains no cache write; proven in Task 5 Step 1 |
| D4 three triggers | Task 2 Steps 4 and 6, Task 3 Step 1, Task 4 Steps 2 and 4 |
| D5 lock-wait 503 unchanged | not touched by any task; listed in Global Constraints |
| D6 416 unchanged | not touched by any task; listed in Global Constraints |
| D7 poster targets only | Task 4 Steps 2, 4, 7 |
| D8 SVG via Sharp | Task 1 Step 3 |
| D9 sizing and clamp | Task 1 Steps 1 and 3 |
| D10 no text | Task 1 Step 3 — the SVG has no `<text>` element |
| D11 params into `handleVideo` | Task 4 Step 1 |
| D12 `saveToCache` isolated, both handlers | Task 2 Step 5, Task 4 Step 3 |
| D13 render failure falls back to JSON | Task 2 Step 3 (the `catch` inside `sendPlaceholder`) |
| D14 image extensions only in `sendOriginal` | Task 2 Step 2, Task 3 Steps 1 and 3 |
| Verification: script | Task 1 Steps 1, 4, 6 |
| Verification: live checks | Task 2 Steps 7-9, Task 3 Steps 2-3, Task 4 Steps 5-8 |
| Verification: cache proof | Task 5 Step 1 |
| Verification: regression | Task 2 Step 9, Task 4 Step 8 |

No gaps.

**Placeholder scan:** every code step carries the real code. The only `TBD`-shaped items are `<your-bucket>`, `<a-real-file>.jpg` and `<a-real-video>.mp4` in shell commands, which are values only the operator's environment can supply.

**Type consistency:** `resolvePlaceholderSize`, `buildPlaceholderSvg` and `renderPlaceholder` are named identically in Task 1's module, Task 1's check script, and Task 2's import. `sendPlaceholder`'s option names (`statusCode`, `filePath`, `params`, `reason`, `fallbackError`, `isVideo`, `videoTarget`) are the same at all seven call sites. `PLACEHOLDER_REASONS`, `PLACEHOLDER_VIDEO_TARGETS` and `isPlaceholderImageExtension` are defined once in Task 2 Step 2 and used with those exact names in Tasks 3 and 4.
