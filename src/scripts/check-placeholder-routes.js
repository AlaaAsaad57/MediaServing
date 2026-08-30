"use strict";

/**
 * Route-level checks for the placeholder fallback.
 *
 * The real S3 client is replaced in the require cache before `app.js` loads,
 * so these checks need no MinIO, no Redis and no network. Fastify's `inject`
 * drives the routes directly.
 *
 * Run: npm run check:placeholder-routes
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const sharp = require("sharp");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.RATE_LIMIT_STORE = "memory";

// ── Stub the S3 client before anything requires it ────────────────────────
const s3Path = require.resolve(path.join(__dirname, "..", "storage", "s3Client"));
const realS3 = require(s3Path);

// Objects the fake bucket contains. Tests mutate this between cases.
const bucket = new Map();
// When set, every storage call throws this instead of answering.
let storageFault = null;

function notFound() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

function faultOrNothing() {
  if (storageFault) throw storageFault;
}

require.cache[s3Path].exports = {
  ...realS3,
  async objectExists(key) {
    faultOrNothing();
    return bucket.has(key);
  },
  async getObjectBuffer(key) {
    faultOrNothing();
    if (!bucket.has(key)) throw notFound();
    return bucket.get(key);
  },
  async getObjectMetadata(key) {
    faultOrNothing();
    if (!bucket.has(key)) throw notFound();
    return { contentLength: bucket.get(key).buffer.length };
  },
  async getObjectStream(key) {
    faultOrNothing();
    if (!bucket.has(key)) throw notFound();
    const { Readable } = require("node:stream");
    const entry = bucket.get(key);
    return { Body: Readable.from([entry.buffer]), ContentType: entry.contentType };
  },
  async putObject(key, buffer, contentType) {
    faultOrNothing();
    bucket.set(key, { buffer, contentType });
    return { key };
  },
};

const { buildApp } = require("../app");

function header(res, name) {
  return res.headers[name.toLowerCase()];
}

async function main() {
  const app = buildApp({ logger: false });
  await app.ready();

  // ── 1. Missing original, with w/h ───────────────────────────────────────
  let res = await app.inject({
    method: "GET",
    url: "/image/upload/w_300,h_200/no-such-file.jpg",
  });
  assert.equal(res.statusCode, 404, "missing original keeps its 404");
  assert.equal(header(res, "content-type"), "image/webp");
  assert.equal(header(res, "cache-control"), "no-store");
  assert.equal(header(res, "x-placeholder"), "1");
  assert.equal(header(res, "x-placeholder-reason"), "not-found");
  assert.equal(header(res, "x-cache"), "NOT_FOUND");
  assert.equal(header(res, "content-disposition"), "inline");
  let meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 200);
  assert.equal(bucket.size, 0, "a failing request writes nothing to storage");
  console.log("ok  404 -> placeholder at the requested size, nothing cached");

  // ── 2. Missing original, no transform params (sendOriginal path) ────────
  res = await app.inject({ method: "GET", url: "/image/upload/no-such.png" });
  assert.equal(res.statusCode, 404);
  assert.equal(header(res, "x-placeholder"), "1");
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 600, "defaults to 600 when no size is asked for");
  assert.equal(meta.height, 600);
  console.log("ok  untransformed image URL -> 600x600 placeholder");

  // ── 3. A non-image extension keeps its JSON error ───────────────────────
  res = await app.inject({ method: "GET", url: "/image/upload/no-such.pdf" });
  assert.equal(res.statusCode, 404);
  assert.equal(header(res, "x-placeholder"), undefined, "no placeholder header");
  assert.deepEqual(res.json(), { error: "Original file not found" });
  console.log("ok  non-image extension keeps its JSON error");

  // ── 4. Storage fault -> 500 + placeholder ───────────────────────────────
  storageFault = Object.assign(new Error("connect ECONNREFUSED"), {
    name: "NetworkingError",
  });
  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_128,h_128/whatever.jpg",
  });
  storageFault = null;
  assert.equal(res.statusCode, 500, "a storage fault keeps its 500");
  assert.equal(header(res, "x-placeholder"), "1");
  assert.equal(header(res, "x-placeholder-reason"), "storage-error");
  assert.equal(header(res, "cache-control"), "no-store");
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 128);
  console.log("ok  storage fault -> 500 + placeholder");

  // ── 5. Corrupt original -> 500 + placeholder (process-error) ────────────
  bucket.set("originals/corrupt.jpg", {
    buffer: Buffer.from("this is definitely not a jpeg"),
    contentType: "image/jpeg",
  });
  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_222,h_111/corrupt.jpg",
  });
  assert.equal(res.statusCode, 500);
  assert.equal(header(res, "x-placeholder"), "1");
  assert.equal(header(res, "x-placeholder-reason"), "process-error");
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 222);
  assert.equal(meta.height, 111);
  assert.equal(
    [...bucket.keys()].filter((k) => k.startsWith("derived/")).length,
    0,
    "a failed transform writes no derived object",
  );
  console.log("ok  corrupt original -> 500 + placeholder, nothing cached");

  // ── 6. Recovery: a real image is served and cached normally ─────────────
  const real = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  // First ask while it is still missing.
  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_400,h_400/recovery.jpg",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(header(res, "x-placeholder"), "1");
  const derivedBefore = [...bucket.keys()].filter((k) =>
    k.startsWith("derived/"),
  ).length;
  assert.equal(derivedBefore, 0, "the placeholder wrote no derived object");

  // Now the original arrives.
  bucket.set("originals/recovery.jpg", {
    buffer: real,
    contentType: "image/jpeg",
  });

  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_400,h_400/recovery.jpg",
  });
  assert.equal(res.statusCode, 200, "the real image is served, not a placeholder");
  assert.equal(header(res, "x-placeholder"), undefined);
  assert.equal(header(res, "x-cache"), "MISS");
  assert.match(header(res, "cache-control"), /immutable/);
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 400);

  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_400,h_400/recovery.jpg",
  });
  assert.equal(header(res, "x-cache"), "HIT", "second request is a cache hit");
  assert.equal(
    [...bucket.keys()].filter((k) => k.startsWith("derived/")).length,
    1,
    "exactly one derived object exists",
  );
  console.log("ok  recovery: placeholder does not survive the image coming back");

  // ── 7. A failed cache write still serves the real image ─────────────────
  bucket.set("originals/writefail.jpg", {
    buffer: real,
    contentType: "image/jpeg",
  });
  const cachedPut = require.cache[s3Path].exports.putObject;
  require.cache[s3Path].exports.putObject = async () => {
    throw new Error("bucket is read-only right now");
  };
  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_150,h_150/writefail.jpg",
  });
  require.cache[s3Path].exports.putObject = cachedPut;
  assert.equal(res.statusCode, 200, "a failed cache write still serves the image");
  assert.equal(header(res, "x-placeholder"), undefined);
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 150);
  console.log("ok  failed cache write still serves the real image");

  // ── 8. Video poster targets ─────────────────────────────────────────────
  res = await app.inject({
    method: "GET",
    url: "/video/upload/w_320,h_180/no-such.mp4?target=webp",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(header(res, "x-placeholder"), "1");
  assert.equal(header(res, "x-video-target"), "webp");
  assert.equal(header(res, "cache-control"), "no-store");
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 180);

  res = await app.inject({
    method: "GET",
    url: "/video/upload/no-such.mp4?target=snapshot",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(header(res, "x-placeholder"), "1");
  meta = await sharp(res.rawPayload).metadata();
  assert.equal(meta.width, 600, "no w/h given -> the 600 default");
  console.log("ok  video poster targets -> placeholder");

  // ── 9. Video byte targets are untouched ─────────────────────────────────
  // `full` has no target name of its own — you omit the query param.
  const byteTargetUrls = {
    full: "/video/upload/no-such.mp4",
    preview: "/video/upload/no-such.mp4?target=preview",
    story: "/video/upload/no-such.mp4?target=story",
    "story-fallback": "/video/upload/no-such.mp4?target=story-fallback",
  };
  for (const [name, url] of Object.entries(byteTargetUrls)) {
    res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 404, `${name} keeps its 404`);
    assert.equal(
      header(res, "x-placeholder"),
      undefined,
      `${name} sends no placeholder`,
    );
    assert.deepEqual(res.json(), { error: "Original file not found" });
  }

  // An unknown target is still a 400, not a placeholder.
  res = await app.inject({
    method: "GET",
    url: "/video/upload/no-such.mp4?target=bogus",
  });
  assert.equal(res.statusCode, 400, "an unknown target is a 400");
  assert.equal(header(res, "x-placeholder"), undefined);
  console.log("ok  video byte targets keep their JSON errors");

  // ── 10. An invalid transform is still a 400, not a placeholder ──────────
  res = await app.inject({
    method: "GET",
    url: "/image/upload/w_abc/no-such-file.jpg",
  });
  assert.notEqual(header(res, "x-placeholder"), "1");
  console.log("ok  a bad transform segment is not turned into a placeholder");

  await app.close();

  // ── 11. The access log line carries the placeholder fields ──────────────
  // A second app with logging on, with stdout captured, so the onResponse
  // hook's JSON line can be inspected.
  const logged = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    logged.push(String(chunk));
    return realWrite(chunk, ...rest);
  };

  const loggingApp = buildApp();
  await loggingApp.ready();
  await loggingApp.inject({
    method: "GET",
    url: "/image/upload/w_64,h_64/log-check.jpg",
  });
  await loggingApp.close();
  process.stdout.write = realWrite;

  const line = logged
    .flatMap((chunk) => chunk.split("\n"))
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .find((entry) => entry && entry.file_path === "log-check.jpg");

  assert.ok(line, "an access log line was emitted for the request");
  assert.equal(line.component, "TransformRoute");
  assert.equal(line.placeholder, "yes");
  assert.equal(line.placeholder_reason, "not-found");
  assert.equal(line.cache_status, "NOT_FOUND");
  // "bypass" is intended: it keeps placeholder responses out of the Loki
  // warm/cold cache-ratio queries, which filter transformed=~"warm|cold".
  assert.equal(line.transformed, "bypass");
  console.log("ok  access log carries placeholder / placeholder_reason");

  console.log("\nAll placeholder route checks passed.");

  // The video queue opens an ioredis connection that retries for ever, so it
  // holds the event loop open even after the app closes. Nothing here needs a
  // graceful drain, so leave straight away.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
