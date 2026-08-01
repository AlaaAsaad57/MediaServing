// Shared machinery for the ticket-authorized upload routes.
//
// Extracted from `gatedUpload.js` when the chat attachment route needed the same
// pieces. Everything here was moved verbatim — the comments explaining WHY each
// guard exists travelled with it, because those reasons are the whole value.
//
// This module owns the parts every gated upload route must get identically: how
// a ticket is read and consumed, what a refusal looks like, what attribution is
// stamped on the object, and how bytes reach storage without being buffered.
// Route-specific concerns (delivery URLs, video derivatives, spreadsheet type
// checks) deliberately stay in the routes.

const fs = require("fs");
const { PassThrough, Transform } = require("stream");
const { once } = require("events");
const { randomUUID } = require("crypto");

const { uploadStream } = require("../storage/s3Client");
const { peek, redeem, StoreUnavailableError } = require("../services/ticketService");
const { fetchUserinfo } = require("../services/userinfoClient");
const { extractMarketToken } = require("../utils/tokenExtractor");

const TICKET_HEADER = "x-upload-ticket";

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function peerAddress(request) {
  return (
    request.raw?.socket?.remoteAddress ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

class TooLargeError extends Error {
  constructor() {
    super("File exceeds the size limit");
    this.code = "UPLOAD_TOO_LARGE";
    this.statusCode = 413;
  }
}

function isTooLargeError(err) {
  return err?.statusCode === 413 || err?.code === "FST_REQ_FILE_TOO_LARGE";
}

// `@fastify/multipart` enforces `limits.fileSize` by **truncating** the part
// stream and ending it normally — it does not raise. Setting the cap there would
// therefore let an oversized upload finish as a silently truncated object, with
// a 201 telling the caller it succeeded.
//
// So the counting guard in `storeStream` is the single enforcement point, and
// multipart's limit is set deliberately ABOVE it as a backstop only, ensuring
// the guard always fires first. When it does, it errors mid-stream and the
// multipart upload is aborted (`leavePartsOnError: false`), so nothing is
// stored.
const LIMIT_HEADROOM_BYTES = 1024 * 1024;

function partLimits(limit, files) {
  return { fileSize: limit + LIMIT_HEADROOM_BYTES, files };
}

// Belt-and-braces: if a truncation ever does slip through (a limit lower than
// ours applied further up the stack), refuse rather than report success.
function assertNotTruncated(part) {
  if (part.file && part.file.truncated) throw new TooLargeError();
}

/**
 * Rate-limit key: the identity pair carried by the ticket.
 *
 * This runs in the plugin's hook, BEFORE the handler redeems the ticket, so it
 * reads the ticket without consuming it. Redemption in the handler remains the
 * single consuming step, so single use is unaffected.
 *
 * No readable ticket (missing, expired, already spent, or the store is away)
 * yields no identity, so the key falls back to the connection peer. Such a
 * request is refused by the handler anyway; the fallback simply stops an
 * unauthenticated caller from sharing everyone else's bucket.
 */
async function gatedKeyGenerator(request) {
  const token = request.headers[TICKET_HEADER];
  if (token) {
    try {
      const record = await peek(token);
      if (record) return `u:${record.user_type}:${record.user_id}`;
    } catch {
      // Store unavailable — fall through to the peer bucket.
    }
  }
  return `p:${peerAddress(request)}`;
}

// One config object for every gated upload route, so the identity bucket and the
// peer fallback carry the SAME limit and window. Divergent limits would make the
// rate-limit headers differ between a live ticket and a spent one, which is a
// probing oracle the uniform 403 exists to avoid.
const gatedUploadRateLimit = {
  max: toInt(process.env.GATED_UPLOAD_RATE_LIMIT_MAX, 20),
  timeWindow: toInt(process.env.GATED_UPLOAD_RATE_LIMIT_WINDOW_MS, 60_000),
  keyGenerator: gatedKeyGenerator,
};

// Every check these routes perform answers ONE uniform result with no sub-code:
// ticket missing, expired, already spent, folder or count mismatch. One opaque
// code gives no probing oracle. Size is the single exception.
function forbidden(reply) {
  return reply.code(403).send({ error: "Forbidden" });
}

/**
 * Take the ticket and consume it, verifying that the caller's market token matches
 * the ticket owner. Returns null when the caller gets a 403.
 * Throws StoreUnavailableError when the permission store or gateway is away (503).
 */
async function consumeTicket(request) {
  const token = request.headers[TICKET_HEADER];
  if (!token || Array.isArray(token)) return null;

  const marketToken = extractMarketToken(request);
  if (!marketToken) return null;

  const identity = await fetchUserinfo(marketToken);
  if (identity.status === "unauthenticated") return null;
  if (identity.status !== "ok") {
    throw new StoreUnavailableError(new Error("Identity service unavailable"));
  }

  const record = await redeem(token);
  if (!record) return null;

  // Verify that the ticket was minted by the same user attempting to upload
  if (
    String(identity.data.id) !== String(record.user_id) ||
    String(identity.data.user_type) !== String(record.user_type)
  ) {
    return null;
  }

  return record;
}

// S3 user metadata. Account type and account id are BOTH required — the
// gateway's id is unique only within its own account type, so `customer` 7 and
// `admin` 7 are different people and the id alone would merge them. Contact
// details are deliberately absent: an immutable object is the wrong carrier for
// a snapshot that goes stale.
function attributionMetadata(record) {
  return {
    "user-type": String(record.user_type),
    "user-id": String(record.user_id),
    "ticket-jti": String(record.jti),
    "uploaded-at": new Date().toISOString(),
  };
}

// Guest rows carry filler the gateway returns exactly as stored. With this
// filter a value in the log is a real contact or nothing — nobody chases "0".
function normaliseContact(record) {
  const rawPhone = record.phone == null ? "" : String(record.phone).trim();
  const rawEmail = record.email == null ? "" : String(record.email).trim();
  const phone = !rawPhone || rawPhone === "0" ? null : rawPhone;
  const email = !rawEmail || /@guest\.com$/i.test(rawEmail) ? null : rawEmail;
  return { phone, email };
}

/**
 * A counting guard: passes bytes through and fails past the cap, so an
 * oversized upload is refused as it arrives rather than after it is stored.
 */
function createCap(limit) {
  const state = { bytes: 0 };
  const stream = new Transform({
    transform(chunk, _enc, cb) {
      state.bytes += chunk.length;
      if (state.bytes > limit) return cb(new TooLargeError());
      cb(null, chunk);
    },
  });
  return { stream, state };
}

/**
 * Stream one file to storage, optionally teeing it to a temp file.
 *
 * Both sinks are piped, so the source pauses for whichever is slower and memory
 * stays flat regardless of how the two race. Errors are forwarded by hand
 * because `pipe` does not carry them.
 */
async function storeStream({ source, key, contentType, metadata, limit, tempPath }) {
  const cap = createCap(limit);
  const s3Sink = new PassThrough();

  source.on("error", (err) => cap.stream.destroy(err));
  cap.stream.on("error", (err) => s3Sink.destroy(err));

  source.pipe(cap.stream);
  cap.stream.pipe(s3Sink);

  let tempDone = Promise.resolve();
  if (tempPath) {
    const tempSink = fs.createWriteStream(tempPath);
    cap.stream.on("error", (err) => tempSink.destroy(err));
    cap.stream.pipe(tempSink);
    tempDone = once(tempSink, "close");
  }

  await Promise.all([
    uploadStream(key, s3Sink, contentType, metadata),
    tempDone,
  ]);

  return cap.state.bytes;
}

/**
 * The stored key for one upload.
 *
 * The name is a server-generated UUID and the extension is byte-derived, so the
 * folder — validated once at mint time and bound into the ticket — is the only
 * client-influenced part, and it can only name a directory inside `originals/`.
 */
function objectKey(folder, extension) {
  const name = `${randomUUID()}.${extension}`;
  return folder ? `originals/${folder}/${name}` : `originals/${name}`;
}

module.exports = {
  TICKET_HEADER,
  TooLargeError,
  toInt,
  peerAddress,
  isTooLargeError,
  partLimits,
  assertNotTruncated,
  gatedKeyGenerator,
  gatedUploadRateLimit,
  forbidden,
  consumeTicket,
  attributionMetadata,
  normaliseContact,
  createCap,
  storeStream,
  objectKey,
};
