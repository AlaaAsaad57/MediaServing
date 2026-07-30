const { getObjectBuffer, putObject } = require("../storage/s3Client");
const { checkCache } = require("./cacheService");
const { processVideo, probeMedia } = require("../processors/videoProcessor");
const { generateDerivedKey } = require("../utils/hashGenerator");
const { isWebPlayable } = require("../utils/mediaProbe");
const {
  previewParams,
  fullParams,
  instantCacheKey,
  createInstantVariant,
} = require("./videoPreprocessor");
const {
  storyVideoCacheKey,
  storyFallbackVideoCacheKey,
  storyVideoParams,
  storyFallbackVideoParams,
} = require("./storyVideoService");

// TASK concurrency — how many encodes run at once *within* one job. The worker's
// JOB concurrency is a separate setting (`VIDEO_JOB_CONCURRENCY`, read only by
// worker.js). One value serving both meanings multiplied the number of live
// ffmpeg children instead of bounding it.
const CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VIDEO_PREPROCESS_CONCURRENCY || "4", 10) || 4,
);

async function runWithConcurrency(tasks, concurrency) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const results = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Attribution for the variants this job writes.
 *
 * Written with the storage helper directly rather than through the cache
 * helper, which takes no metadata — that file is not part of this change.
 * Returns undefined when the job carries no attribution (the delivery route and
 * the backfill script both enqueue without a ticket), and the write then behaves
 * exactly as it did before.
 */
function variantMetadata(attribution) {
  if (!attribution || !attribution.user_type || !attribution.user_id) {
    return undefined;
  }
  return {
    "user-type": String(attribution.user_type),
    "user-id": String(attribution.user_id),
    "ticket-jti": String(attribution.ticket_jti || ""),
    "uploaded-at": new Date().toISOString(),
  };
}

async function generatePolishedVariants(originalKey, relativePath, opts, logger) {
  const original = await getObjectBuffer(originalKey);
  const buf = original.buffer;
  const metadata = variantMetadata(opts && opts.attribution);

  const make = (derivedKey, params, label) => async () => {
    if (await checkCache(derivedKey)) {
      logger.info({ derivedKey }, `${label} already cached, skipping`);
      return;
    }
    const { buffer, contentType } = await processVideo(buf, params);
    await putObject(derivedKey, buffer, contentType, metadata);
    logger.info({ derivedKey, size: buffer.length }, `${label} created`);
  };

  // The instant variant: a normalised MP4 for sources a browser will not play
  // as-is. The gated upload path streams and never holds the bytes, so this
  // moved here from the request — at the raised size cap a full transcode
  // cannot sit inside an upload.
  const makeInstant = () => async () => {
    const derivedKey = instantCacheKey(originalKey);
    if (await checkCache(derivedKey)) return;
    let info;
    try {
      info = await probeMedia(buf);
    } catch (err) {
      logger.error({ originalKey, error: err.message }, "Probe failed; skipping instant variant");
      return;
    }
    if (isWebPlayable(info)) return;
    const { buffer, contentType } = await createInstantVariant(buf);
    await putObject(derivedKey, buffer, contentType, metadata);
    logger.info({ derivedKey, size: buffer.length }, "Instant variant created");
  };

  let tasks;
  if (opts && opts.story === true) {
    tasks = [
      make(storyVideoCacheKey(originalKey), storyVideoParams(), "Story variant"),
      make(
        storyFallbackVideoCacheKey(originalKey),
        storyFallbackVideoParams(),
        "Story fallback variant",
      ),
    ];
  } else {
    const pv = previewParams();
    const fv = fullParams();
    tasks = [
      makeInstant(),
      make(generateDerivedKey(originalKey, pv), pv, "Preview"),
      make(generateDerivedKey(originalKey, fv), fv, "Full variant"),
    ];
  }

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const failures = results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason);
  if (failures.length > 0) {
    for (const f of failures) {
      logger.error({ error: f?.message }, "Video variant generation failed");
    }
    throw new Error("One or more video variants failed to generate");
  }
}

module.exports = { generatePolishedVariants };
