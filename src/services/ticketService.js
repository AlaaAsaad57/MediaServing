// Upload permissions ("tickets"), and the counters that bound the mint route.
//
// A ticket is an opaque random token held in Redis. It is not a JWT: Redis gives
// expiry, single use and revocation for free, with no signing key to manage, and
// a JWT can be neither used up nor cancelled.
//
// **No in-memory fallback.** The lock service falls back to a Map when Redis is
// away; that pattern must not be copied here. An in-memory map cannot enforce
// single use, and would break outright the moment a second instance exists — a
// failure that would appear later and look random. Redis is a hard dependency of
// the gated routes: unavailable means 503, never "allow".

const { randomBytes, randomUUID } = require("crypto");
const { createRedisClient } = require("./lockService");

// Fixed by the acceptance criteria, so deliberately NOT configurable —
// configuration here would let deployed behaviour drift from verified behaviour.
const TICKET_TTL_SECONDS = 120;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// Story uploads keep the tighter limit the current route applies.
const STORY_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const TICKET_PREFIX = "upload:ticket:";
const QUOTA_PREFIX = "upload:quota:";

let redis = null;
let ready = false;

function client() {
  if (redis) return redis;
  redis = createRedisClient();
  redis.on("error", () => {
    ready = false;
  });
  redis
    .connect()
    .then(() => {
      ready = true;
    })
    .catch(() => {
      ready = false;
    });
  return redis;
}

class StoreUnavailableError extends Error {
  constructor(cause) {
    super("Permission store unavailable");
    this.code = "TICKET_STORE_UNAVAILABLE";
    this.statusCode = 503;
    this.cause = cause;
  }
}

async function withStore(fn) {
  try {
    const result = await fn(client());
    ready = true;
    return result;
  } catch (err) {
    ready = false;
    throw new StoreUnavailableError(err);
  }
}

/**
 * Is the store reachable? Used by /health, which reports this WITHOUT changing
 * its own status code — /health is the container liveness probe, and a Redis
 * blip must not cause a restart. Uploads fail on their own routes instead.
 */
async function isReachable() {
  try {
    const pong = await client().ping();
    ready = pong === "PONG";
    return ready;
  } catch {
    ready = false;
    return false;
  }
}

/**
 * Consume one unit from a fixed-window counter.
 *
 * Used for both mint-route bounds that are not the plugin's job: the
 * connection-peer bucket, and the service-wide ceiling on outbound identity
 * calls. Returns how much of the window is left so the caller can decide
 * whether a retry is still affordable.
 */
async function consumeQuota(name, limit, windowSeconds) {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${QUOTA_PREFIX}${name}:${window}`;
  return withStore(async (r) => {
    const used = await r.incr(key);
    if (used === 1) {
      // Twice the window, so a counter never outlives its usefulness but also
      // never expires mid-window.
      await r.expire(key, windowSeconds * 2);
    }
    return { used, limit, remaining: Math.max(limit - used, 0), allowed: used <= limit };
  });
}

// A folder is a `/`-separated relative path of plain segments (`product`,
// `product/descriptors`, `a/b/c`). Rejected: any `.` or `..` segment, leading or
// trailing `/`, an empty segment, backslash, NUL, or any character outside
// [A-Za-z0-9._-]. Validated once, here, and bound into the ticket — the upload
// then uses the ticket's folder, never anything the caller sends again. With the
// server-generated object name this leaves the folder as the only
// client-influenced part of the key, and it can only name a directory inside
// `originals/`.
const FOLDER_SEGMENT = /^[A-Za-z0-9._-]+$/;

function validateFolder(folder) {
  const raw = String(folder ?? "");
  if (!raw) return { ok: true, folder: "" };
  if (raw.includes("\\") || raw.includes("\0")) return { ok: false };
  if (raw.startsWith("/") || raw.endsWith("/")) return { ok: false };

  const segments = raw.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return { ok: false };
    if (!FOLDER_SEGMENT.test(segment)) return { ok: false };
  }
  return { ok: true, folder: segments.join("/") };
}

/**
 * Mint a permission.
 *
 * The record binds the identity pair, the validated folder, the byte cap, the
 * file count and its own id — that is the authorization scope, and nothing in it
 * is client-controlled after this point.
 *
 * It also carries a contact snapshot (`phone`, `email`) which is NOT part of the
 * authorization scope: it exists only so the upload log line can record who
 * uploaded, since the upload request never talks to the gateway. Those two
 * fields never reach the stored object and never reach a background job.
 */
async function mint({ userType, userId, folder, count, story, phone, email }) {
  const token = randomBytes(32).toString("base64url");
  const jti = randomUUID();
  const maxBytes = story === true ? STORY_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;

  const record = {
    user_type: userType,
    user_id: String(userId),
    folder: folder || "",
    max_bytes: maxBytes,
    count: count || 1,
    story: story === true,
    jti,
    // Contact snapshot — log line only (see above).
    phone: phone ?? null,
    email: email ?? null,
  };

  await withStore((r) =>
    r.set(`${TICKET_PREFIX}${token}`, JSON.stringify(record), "EX", TICKET_TTL_SECONDS),
  );

  return { token, jti, maxBytes, expiresIn: TICKET_TTL_SECONDS, record };
}

/**
 * Read a ticket WITHOUT consuming it.
 *
 * Only the rate-limit key generator uses this. That hook runs before the route
 * handler, so it needs the identity pair to pick a bucket while redemption is
 * still ahead of it. A destructive read here would consume the ticket before the
 * handler ever saw it, and every gated upload would fail.
 */
async function peek(token) {
  if (!token) return null;
  const raw = await withStore((r) => r.get(`${TICKET_PREFIX}${token}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Consume a ticket. Single use, atomically.
 *
 * GET and DEL run inside one MULTI/EXEC, so two concurrent requests presenting
 * the same ticket cannot both read it before either deletes it — exactly one
 * gets the record and the other gets null. A transaction rather than GETDEL
 * because it is atomic on every Redis version, which removes the question of
 * what the deployed server supports.
 *
 * This is the SINGLE consuming step for a ticket.
 */
async function redeem(token) {
  if (!token) return null;
  const key = `${TICKET_PREFIX}${token}`;
  const results = await withStore((r) => r.multi().get(key).del(key).exec());
  if (!Array.isArray(results) || !results.length) return null;

  const [getErr, raw] = results[0] || [];
  if (getErr || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  TICKET_TTL_SECONDS,
  MAX_UPLOAD_BYTES,
  STORY_MAX_UPLOAD_BYTES,
  StoreUnavailableError,
  isReachable,
  consumeQuota,
  validateFolder,
  mint,
  peek,
  redeem,
};
