#!/usr/bin/env node

/**
 * Tiny Preview Backfill Script
 *
 * Scans S3 for every image under originals/ and makes the tiny w_24/f_webp/q_25
 * copy that uploads now make at upload time. Run this once for old images.
 * It is safe to run again: an image that already has its copy is skipped.
 *
 * Usage:
 *   node src/scripts/preprocess-images.js [options]
 *
 * Options:
 *   --dry-run          Report what would be made. Reads only, writes nothing.
 *   --concurrency <n>  Images at once (default: 2)
 *   --prefix <path>    Only scan under this S3 key prefix
 *                      e.g. --prefix originals/product/
 *
 * Environment variables:
 *   S3_* vars (already configured for the project)
 */

// ── Load project env ────────────────────────────────────────────────────────
require("../config/env");

const { s3, BUCKET, getObjectBuffer } = require("../storage/s3Client");
const { checkCache } = require("../services/cacheService");
const {
  isLargeSvg,
  tinyPreviewKey,
  saveTinyPreview,
  runPool,
} = require("../services/tinyPreview");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");

// ── Images the delivery route can resize ─────────────────────────────────────
// Not isInlineSafeExtension: that also admits video extensions.
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
]);

// Chat attachments live under originals/ too, but the store never shows them.
const CHAT_PREFIX = "originals/chat/";

function isImageKey(key) {
  if (key.startsWith(CHAT_PREFIX)) return false;
  const ext = key.split(".").pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  // Each image in progress holds its whole original in memory.
  const opts = { dryRun: false, concurrency: 2, prefix: "originals/" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--concurrency":
        opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 2);
        break;
      case "--prefix":
        opts.prefix = args[++i];
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

// ── S3 list helpers ───────────────────────────────────────────────────────────
let largeSvgs = 0;

async function* listImageKeys(prefix) {
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const res = await s3.send(cmd);
    for (const obj of res.Contents || []) {
      if (!isImageKey(obj.Key)) continue;
      if (isLargeSvg(obj.Key, obj.Size)) {
        largeSvgs++;
        continue;
      }
      yield obj.Key;
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  console.log("=== Tiny Preview Backfill ===");
  console.log(`  Bucket  : ${BUCKET}`);
  console.log(`  Prefix  : ${opts.prefix}`);
  console.log(`  Workers : ${opts.concurrency}`);
  if (opts.dryRun) console.log("  Mode    : DRY RUN (no writes)");
  console.log("");

  // Collect all image keys first so we can show totals
  process.stdout.write("Scanning S3 for images … ");
  const imageKeys = [];
  for await (const key of listImageKeys(opts.prefix)) {
    imageKeys.push(key);
  }
  console.log(`found ${imageKeys.length} image(s)`);
  console.log(`Left for their first GET: ${largeSvgs} large SVG(s)\n`);

  if (imageKeys.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let done = 0;
  let made = 0;
  let skipped = 0;
  let failed = 0;

  await runPool(imageKeys, opts.concurrency, async (originalKey) => {
    const relativePath = originalKey.replace(/^originals\//, "");
    const label = `[${++done}/${imageKeys.length}] ${relativePath}`;

    try {
      if (await checkCache(tinyPreviewKey(originalKey))) {
        console.log(`  ✓ SKIP  ${label} (already has the tiny copy)`);
        skipped++;
        return;
      }

      if (opts.dryRun) {
        console.log(`  • WOULD ${label}`);
        made++;
        return;
      }

      const { buffer } = await getObjectBuffer(originalKey);
      await saveTinyPreview(originalKey, buffer);
      console.log(`  ✓ DONE  ${label}`);
      made++;
    } catch (err) {
      // One bad file must not stop the run.
      console.error(`  ✗ FAIL  ${label} — ${err.message}`);
      failed++;
    }
  });

  console.log("\n=== Summary ===");
  console.log(`  ${opts.dryRun ? "Would make" : "Made"} : ${made}`);
  console.log(`  Skipped   : ${skipped} (already have the tiny copy)`);
  console.log(`  Failed    : ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
