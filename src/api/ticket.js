// POST /gated/ticket — stage one of the two-stage upload.
//
// The caller proves who it is with its market access token and receives a
// short-lived, single-use, scoped permission. The upload itself (stage two) is
// authorized only by that permission; the static API key is never accepted under
// /gated/*.

const { createHash } = require("crypto");
const {
  fetchUserinfo,
  mayUpload,
} = require("../services/userinfoClient");
const {
  consumeQuota,
  validateFolder,
  mint,
  StoreUnavailableError,
  MAX_UPLOAD_BYTES,
  STORY_MAX_UPLOAD_BYTES,
} = require("../services/ticketService");

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Per-caller bucket. The token is one-per-caller by construction and cannot be
// forged for someone else. The hash is a limiter key only — never logged,
// stored, or returned.
function tokenBucket(token) {
  return `t:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
}

function bearerToken(request) {
  const header = request.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// The socket's remote address, NOT the framework's proxy-aware address: a
// forwarding header must not let a caller pick its own bucket. Behind a proxy
// this collapses to one bucket for everyone, which is why it is sized
// generously and the outbound ceiling below is what actually bounds gateway
// traffic.
function peerAddress(request) {
  return (
    request.raw?.socket?.remoteAddress ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

const mintRateLimit = {
  max: toInt(process.env.TICKET_RATE_LIMIT_MAX, 30),
  timeWindow: toInt(process.env.TICKET_RATE_LIMIT_WINDOW_MS, 60_000),
  keyGenerator(request) {
    const token = bearerToken(request);
    return token ? tokenBucket(token) : `p:${peerAddress(request)}`;
  },
};

async function ticketRoutes(fastify) {
  fastify.post(
    "/gated/ticket",
    { config: { rateLimit: mintRateLimit } },
    async (request, reply) => {
      const token = bearerToken(request);
      if (!token) {
        // No token at all is "not signed in", the same answer the gateway gives
        // for a bad one.
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const peerMax = toInt(process.env.TICKET_PEER_LIMIT_MAX, 120);
      const ceilingMax = toInt(process.env.GATEWAY_CALL_CEILING_PER_MIN, 600);

      let allowRetry = true;
      try {
        // Bound 2 — connection peer, checked BEFORE the gateway is called so a
        // caller rotating tokens cannot turn this route into an amplifier.
        const peer = await consumeQuota(`peer:${peerAddress(request)}`, peerMax, 60);
        if (!peer.allowed) {
          return reply.code(429).send({
            error: "Too Many Requests",
            statusCode: 429,
          });
        }

        // Bound 3 — a service-wide ceiling on outbound identity calls. This is
        // the bound that holds regardless of proxy topology; the peer bucket
        // collapses behind a proxy and cannot be relied on for it.
        const ceiling = await consumeQuota("gateway", ceilingMax, 60);
        if (!ceiling.allowed) {
          return reply.code(503).send({ error: "Service unavailable" });
        }
        // Close to the cap: spend one attempt, not two.
        allowRetry = ceiling.remaining > 1;
      } catch (err) {
        if (err instanceof StoreUnavailableError) {
          return reply.code(503).send({ error: "Service unavailable" });
        }
        throw err;
      }

      const identity = await fetchUserinfo(token, { allowRetry });
      if (identity.status === "unauthenticated") {
        // Never create or assume a guest here.
        return reply.code(401).send({ error: "Unauthorized" });
      }
      if (identity.status !== "ok") {
        // "My dependency is down" — not the caller's fault, and never "allow".
        return reply.code(503).send({ error: "Service unavailable" });
      }

      // The flag decides WHO, not WHAT. Both conditions must hold.
      if (!mayUpload(identity.data)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const body = request.body || {};
      const folderCheck = validateFolder(body.folder);
      if (!folderCheck.ok) {
        return reply.code(400).send({ error: "Invalid folder" });
      }

      const story = body.story === true || body.story === "true";
      const bulkMax = toInt(process.env.UPLOAD_BULK_MAX_FILES, 50);
      const requestedCount = toInt(body.count, 1);
      if (requestedCount > bulkMax) {
        return reply.code(400).send({ error: "Too many files requested" });
      }

      let minted;
      try {
        minted = await mint({
          userType: identity.data.user_type,
          userId: identity.data.id,
          folder: folderCheck.folder,
          count: requestedCount,
          story,
          phone: identity.data.phone,
          email: identity.data.email,
        });
      } catch (err) {
        if (err instanceof StoreUnavailableError) {
          return reply.code(503).send({ error: "Service unavailable" });
        }
        throw err;
      }

      request._logExtra = {
        component: "TicketRoute",
        user_type: identity.data.user_type,
        user_id: String(identity.data.id),
        ticket_jti: minted.jti,
      };

      return reply.code(201).send({
        ticket: minted.token,
        expires_in: minted.expiresIn,
        // Returned so a client can refuse an oversized file before sending it.
        max_bytes: story ? STORY_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES,
      });
    },
  );
}

module.exports = ticketRoutes;
