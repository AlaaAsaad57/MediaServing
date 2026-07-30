// POST /gated/chat/upload_file  and  GET /chat/file/*
//
// A chat attachment is stored and handed back, and that is all: no transform, no
// probe, no poster, no queue, no worker. The bytes travel from the request
// socket through a counting guard into S3 and are never held whole in memory, so
// the cost of this route is flat in the size of the file.
//
// The two halves live in one module because the upload's only product is a URL
// the download route has to honour — the key layout, the prefix and the
// disposition rules are one decision, and splitting them lets the halves drift.
//
// Authorized exactly like the other gated routes: a permission minted at
// /gated/ticket, presented once in X-Upload-Ticket. The static API key is never
// accepted. The download side is public, because the URL is meant to be pasted
// straight into a chat message.

const path = require("path");

const { getObjectMetadata, getObjectStream } = require("../storage/s3Client");
const { parseSingleRangeHeader } = require("../utils/rangeRequest");
const {
  sniff,
  readHead,
  prependHead,
  isInlineSafeContentType,
  SIGNATURE_BYTES,
} = require("../utils/byteSniffer");
const { StoreUnavailableError } = require("../services/ticketService");
const {
  toInt,
  isTooLargeError,
  partLimits,
  assertNotTruncated,
  gatedUploadRateLimit,
  forbidden,
  consumeTicket,
  attributionMetadata,
  normaliseContact,
  storeStream,
  objectKey,
} = require("./gatedSupport");

// Every chat object lives under this one prefix, and the download route below
// hard-prefixes the same string.
//
// The ticket's bound `folder` is deliberately IGNORED here. On the other gated
// routes the folder is the one client-influenced part of the key; on this one
// there is none at all — prefix, UUID name and byte-derived extension are all
// chosen by the server. That is also what makes the download route safe to
// leave public: `/chat/file/*` resolves inside `originals/chat/` and cannot be
// walked out into the rest of `originals/`.
const CHAT_PREFIX = "chat";

// Its own cap rather than the ticket's 100 MB: a chat attachment is not a media
// upload, and the ceiling that suits a source video is the wrong one to leave
// open on a route anyone signed in can reach.
function chatMaxBytes() {
  return toInt(process.env.CHAT_UPLOAD_MAX_FILE_SIZE_MB, 25) * 1024 * 1024;
}

// Delivery is cheap (a straight S3 stream) and a single chat thread can pull
// many attachments plus a Range request per seek, so this is far looser than the
// upload limit. Keyed by the global generator — these requests carry no ticket.
const chatFileRateLimit = {
  max: toInt(process.env.CHAT_FILE_RATE_LIMIT_MAX, 600),
  timeWindow: toInt(process.env.CHAT_FILE_RATE_LIMIT_WINDOW_MS, 60_000),
};

/**
 * The chat client renders these URLs directly, so they must be absolute.
 *
 * `MEDIA_PUBLIC_BASE_URL` is the media host and already exists in both env
 * files. Without it we derive the origin from the request, as the spreadsheet
 * route does: `trustProxy` is on, so `request.protocol` honours
 * X-Forwarded-Proto and the Host header carries any non-default port.
 */
function publicUrl(request, pathname) {
  const configured =
    process.env.MEDIA_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  const base = configured
    ? configured.replace(/\/+$/, "")
    : `${request.protocol}://${request.headers.host}`;
  return `${base}${pathname}`;
}

/**
 * The stored object's name is a UUID, so the caller's name is kept as S3 user
 * metadata purely to give a downloaded file something human on disk.
 *
 * S3 user metadata travels in HTTP headers, so it must be ASCII — a non-ASCII
 * value would make the PUT itself fail. Anything that will not survive a header
 * is therefore dropped rather than mangled, and the download route falls back to
 * the UUID. Quotes and backslashes go too, since the value is interpolated into
 * a Content-Disposition filename.
 */
function asciiName(filename) {
  return path
    .basename(String(filename || ""))
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim()
    .slice(0, 100);
}

/**
 * The wildcard may only name something inside `originals/chat/`.
 *
 * A `..` or empty segment, a backslash or a NUL is refused outright rather than
 * normalised away, so there is no encoding left to be clever with. Fastify has
 * already percent-decoded the parameter by the time we see it.
 */
function sanitizeChatPath(wildcard) {
  const cleaned = String(wildcard || "").replace(/^\/+/, "");
  if (!cleaned) return null;
  if (cleaned.includes("\\") || cleaned.includes("\0")) return null;
  if (cleaned.split("/").some((s) => !s || s === "." || s === "..")) return null;
  return cleaned;
}

function isNotFound(err) {
  return (
    err?.name === "NotFound" ||
    err?.name === "NoSuchKey" ||
    err?.$metadata?.httpStatusCode === 404
  );
}

async function chatRoutes(fastify) {
  // ── Upload ───────────────────────────────────────────────────────────────
  fastify.post(
    "/gated/chat/upload_file",
    { config: { rateLimit: gatedUploadRateLimit } },
    async (request, reply) => {
      let record;
      try {
        record = await consumeTicket(request);
      } catch (err) {
        if (err instanceof StoreUnavailableError) {
          return reply.code(503).send({ error: "Service unavailable" });
        }
        throw err;
      }
      if (!record) return forbidden(reply);

      // The tighter of the two wins: this route's own cap, and the ceiling the
      // mint already promised this ticket (10 MB for a story ticket).
      const limit = Math.min(record.max_bytes, chatMaxBytes());
      const contact = normaliseContact(record);

      try {
        for await (const part of request.parts({ limits: partLimits(limit, 1) })) {
          if (part.type !== "file") continue;

          // The bytes decide what this is — never the filename, never the
          // Content-Type the client declared.
          const head = await readHead(part.file, SIGNATURE_BYTES);
          const sniffed = sniff(head);
          const source = prependHead(head, part.file);

          const metadata = attributionMetadata(record);
          const originalName = asciiName(part.filename);
          if (originalName) metadata["original-name"] = originalName;

          const key = objectKey(CHAT_PREFIX, sniffed.extension);
          const size = await storeStream({
            source,
            key,
            contentType: sniffed.contentType,
            metadata,
            limit,
          });
          assertNotTruncated(part);

          const filename = path.basename(key);

          request._logExtra = {
            component: "ChatUploadRoute",
            resource_type: sniffed.media,
            s3_key: key,
            file_size_bytes: size,
            user_type: record.user_type,
            user_id: record.user_id,
            ticket_jti: record.jti,
            phone: contact.phone,
            email: contact.email,
          };

          return reply.code(201).send({
            url: publicUrl(request, `/chat/file/${filename}`),
            key,
            filename,
            originalName: part.filename ?? null,
            contentType: sniffed.contentType,
            size,
            type: sniffed.media,
          });
        }

        return reply.code(400).send({ error: "File is required" });
      } catch (err) {
        if (isTooLargeError(err)) {
          return reply.code(413).send({ error: "File exceeds the size limit" });
        }
        throw err;
      }
    },
  );

  // ── Download ─────────────────────────────────────────────────────────────
  // Public (allowlisted in authHook) so the URL handed back above is usable
  // as-is in a chat message.
  fastify.get(
    "/chat/file/*",
    { config: { rateLimit: chatFileRateLimit } },
    async (request, reply) => {
      const relativePath = sanitizeChatPath(request.params["*"]);
      if (!relativePath) {
        return reply.code(400).send({ error: "File path is required" });
      }

      const key = `originals/${CHAT_PREFIX}/${relativePath}`;

      // HEAD first: the total length is what makes a Range answerable, and it
      // also means a miss costs no body transfer.
      let object;
      try {
        object = await getObjectMetadata(key);
      } catch (err) {
        if (isNotFound(err)) {
          return reply.code(404).send({ error: "File not found" });
        }
        throw err;
      }

      const totalLength = Number(object.contentLength || 0);
      const contentType = object.contentType || "application/octet-stream";
      const range = parseSingleRangeHeader(request.headers.range, totalLength);

      // Advertised unconditionally: a player checks for this before it will let
      // the user seek at all.
      reply.header("Accept-Ranges", "bytes");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cross-Origin-Resource-Policy", "cross-origin");

      // Answered before the body headers, so a 416 is a plain JSON error rather
      // than an empty response wearing a media Content-Type.
      if (range.kind === "invalid" || range.kind === "unsatisfiable") {
        reply.code(416);
        reply.header("Content-Range", `bytes */${totalLength}`);
        return reply.send({ error: "Requested range not satisfiable" });
      }

      // The disposition comes from the STORED content type, which was derived
      // from the bytes at upload. So an image, a video or an audio file renders
      // or plays, and anything else — including bytes that were never
      // recognised — downloads, whatever it happens to be named.
      const inline = isInlineSafeContentType(contentType);
      const downloadName =
        object.metadata?.["original-name"] || path.basename(relativePath);

      reply.header("Content-Type", contentType);
      reply.header(
        "Content-Disposition",
        inline ? "inline" : `attachment; filename="${downloadName}"`,
      );
      // The key is a UUID and the object is never rewritten, so it is safe to
      // cache forever.
      reply.header(
        "Cache-Control",
        process.env.MEDIA_CACHE_CONTROL ||
          "public, max-age=31536000, s-maxage=31536000, immutable",
      );
      if (object.etag) reply.header("ETag", object.etag);

      let body;
      try {
        body = await getObjectStream(key, {
          range: range.kind === "partial" ? range.storageRange : undefined,
        });
      } catch (err) {
        if (isNotFound(err)) {
          return reply.code(404).send({ error: "File not found" });
        }
        throw err;
      }

      if (range.kind === "partial") {
        reply.code(206);
        reply.header("Content-Range", range.headerValue);
        reply.header("Content-Length", String(range.contentLength));
      } else if (totalLength) {
        reply.header("Content-Length", String(totalLength));
      }

      request._logExtra = {
        component: "ChatFileRoute",
        resource_type: "chat_file",
        s3_key: key,
        range: range.kind,
      };

      // Streamed, never buffered: a warm attachment must not become its own
      // size in heap for every concurrent reader.
      return reply.send(body.Body);
    },
  );
}

module.exports = chatRoutes;
