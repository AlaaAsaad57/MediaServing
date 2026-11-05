// The tiny photo the store shows while the real photo loads.
//
// The frontend asks for /image/upload/w_24/f_webp/q_25/<path>. Made on demand,
// that first request downloads the whole original, so it is made ahead of time:
// at upload, and for old images by src/scripts/preprocess-images.js.
//
// The copy is only useful if its key is the exact key the delivery route looks
// up. If the two ever differ, nothing fails: the copy is simply never found.

const { parseChainedTransformations } = require("../utils/paramParser");
const { generateDerivedKey } = require("../utils/hashGenerator");
const { getObjectBuffer, putObject } = require("../storage/s3Client");
const { processImage } = require("../processors/imageProcessor");
const { saveToCache } = require("./cacheService");

// One entry per URL segment, because the delivery route parses them one by one.
// Do not join them for parseParams: it reads "w_24/f_webp/q_25" as just { w: 24 }.
const TINY_PREVIEW_SEGMENTS = ["w_24", "f_webp", "q_25"];

// Above this size an SVG waits for its first GET. One 9 MB SVG took 5.4 seconds and
// about 750 MB to draw, and neither an upload nor the backfill should risk that.
const SVG_WARM_MAX_BYTES = 1024 * 1024;

function isSvgKey(originalKey) {
  return originalKey.toLowerCase().endsWith(".svg");
}

function isLargeSvg(originalKey, size) {
  return isSvgKey(originalKey) && size > SVG_WARM_MAX_BYTES;
}

// The same params handleImage in api/transform.js hashes for this URL. That route
// forces PNG for an SVG source, so the key for an SVG has f=png, not f=webp.
function tinyPreviewParams(originalKey) {
  const params = parseChainedTransformations(TINY_PREVIEW_SEGMENTS);
  if (isSvgKey(originalKey)) params.f = "png";
  return params;
}

function tinyPreviewKey(originalKey) {
  return generateDerivedKey(originalKey, tinyPreviewParams(originalKey));
}

/**
 * Make the tiny copy and store it. Throws on failure.
 *
 * `metadata` is the attribution every object on a gated route carries. saveToCache
 * cannot write metadata, so those objects go through putObject, like the posters.
 */
async function saveTinyPreview(originalKey, originalBuffer, metadata) {
  const { buffer, contentType } = await processImage(
    originalBuffer,
    tinyPreviewParams(originalKey),
  );
  const derivedKey = tinyPreviewKey(originalKey);
  if (metadata) {
    await putObject(derivedKey, buffer, contentType, metadata);
  } else {
    await saveToCache(derivedKey, buffer, contentType);
  }
  return derivedKey;
}

/**
 * The upload routes' version: it never throws, so a failed tiny copy cannot fail
 * an upload. The delivery route still makes the copy on demand.
 *
 * Without `buffer`, the original is read back from storage, and `size` must be
 * given so a large SVG is skipped before that read.
 */
async function warmTinyPreview({ key, buffer, size = buffer?.length, metadata, log }) {
  if (isLargeSvg(key, size)) return;

  try {
    const source = buffer || (await getObjectBuffer(key)).buffer;
    await saveTinyPreview(key, source, metadata);
  } catch (err) {
    log?.error(
      { s3_key: key, error: err.message },
      "Tiny preview generation failed",
    );
  }
}

// Run `fn` over `items`, never more than `concurrency` at once.
async function runPool(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    },
  );
  await Promise.all(workers);
}

module.exports = {
  isLargeSvg,
  tinyPreviewParams,
  tinyPreviewKey,
  saveTinyPreview,
  warmTinyPreview,
  runPool,
};
