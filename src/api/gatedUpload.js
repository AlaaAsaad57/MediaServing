// POST /gated/upload, /gated/upload/bulk, /gated/upload/excel — stage two.
//
// Authorized ONLY by the permission minted at /gated/ticket. The static API key
// is never accepted here. Everything the caller could previously choose — the
// destination folder, the object name, the stored type — is either bound into
// the ticket or derived from the bytes.
//
// The body streams to storage and is never held whole in memory. For video the
// same stream is also written to a temp file as it passes, so probe, snapshot
// and poster can run from disk without ever building a buffer: ffmpeg reads
// files anyway, so this costs one write and no heap.

const path = require("path");

const { putObject } = require("../storage/s3Client");
const { checkCache } = require("../services/cacheService");
const { StoreUnavailableError } = require("../services/ticketService");
const {
  sniff,
  isVideoKind,
  isAudioKind,
  readHead,
  prependHead,
  SIGNATURE_BYTES,
} = require("../utils/byteSniffer");
// The ticket plumbing every gated upload route shares. It lived here until the
// chat attachment route needed the same pieces; the routes below are otherwise
// unchanged.
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
const {
  probeMediaFromPath,
  extractSnapshotFromPath,
  tmpPath,
  cleanup,
} = require("../processors/videoProcessor");
const {
  snapshotCacheKey,
  webpCacheKey,
  createWebpPosterVariantFromPath,
  getVariantUrls,
  SNAPSHOT_SECOND,
} = require("../services/videoPreprocessor");
const { getStoryUrls } = require("../services/storyVideoService");
const { enqueueVideoJob } = require("../services/videoQueue");

// Spreadsheet types. The extension cannot come from the bytes here — .xlsx and
// .xlsm are both ZIP archives — so the extension is checked against this map and
// the BYTES must agree with the container it implies. Same property as the
// existing spreadsheet route: a renamed file is refused.
const EXCEL_CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
};
const EXCEL_CONTAINER_BY_EXT = { xlsx: "zip", xlsm: "zip", xlsb: "zip", xls: "ole2" };

function deliveryUrl(folder, relativePath, resourceType) {
  // The profile folder keeps its bare-path form, as the existing route returns.
  if (folder === "customers/profile") return `/${relativePath}`;
  return `/${resourceType}/upload/${relativePath}`;
}

/**
 * Derived video assets, built from the temp file the upload already wrote.
 *
 * Posters are warm at upload exactly as the existing route makes them, so the
 * delivery route's inline transcode stays a cold path. The heavy transcodes —
 * the instant variant and the polished variants — go to the worker; at 100 MB
 * they cannot sit inside a request.
 */
async function buildVideoDerivatives({ tempPath, key, metadata, story, log }) {
  const info = await probeMediaFromPath(tempPath);

  try {
    const snapKey = snapshotCacheKey(key);
    if (!(await checkCache(snapKey))) {
      const snap = await extractSnapshotFromPath(tempPath, SNAPSHOT_SECOND);
      await putObject(snapKey, snap.buffer, snap.contentType, metadata);
    }
    const posterKey = webpCacheKey(key);
    if (!(await checkCache(posterKey))) {
      const poster = await createWebpPosterVariantFromPath(tempPath);
      await putObject(posterKey, poster.buffer, poster.contentType, metadata);
    }
  } catch (err) {
    // Poster failures are logged, not fatal: the delivery route can still make
    // them on demand.
    log.error({ s3_key: key, error: err.message }, "Poster generation failed");
  }

  enqueueVideoJob(
    {
      originalKey: key,
      relativePath: key.replace(/^originals\//, ""),
      story: story === true,
      attribution: {
        user_type: metadata["user-type"],
        user_id: metadata["user-id"],
        ticket_jti: metadata["ticket-jti"],
      },
    },
    log,
  ).catch((err) =>
    log.error({ s3_key: key, error: err.message }, "enqueue failed"),
  );

  return info;
}

async function gatedUploadRoutes(fastify) {
  // ── Single upload ────────────────────────────────────────────────────────
  fastify.post(
    "/gated/upload",
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

      const metadata = attributionMetadata(record);
      const contact = normaliseContact(record);
      let tempPath = null;

      try {
        for await (const part of request.parts({
          limits: partLimits(record.max_bytes, 1),
        })) {
          if (part.type !== "file") continue;

          // The bytes decide what this is, before the key is chosen.
          const head = await readHead(part.file, SIGNATURE_BYTES);
          const sniffed = sniff(head);
          const source = prependHead(head, part.file);

          const isVideo = isVideoKind(sniffed.kind);
          // Audio has no transform pipeline and no delivery route of its own, so
          // it is stored as-is and handed back through the originals download
          // route. It needs its own branch because the alternative is the image
          // one, and an .m4a announced as an image is worse than useless.
          const isAudio = isAudioKind(sniffed.kind);
          const key = objectKey(record.folder, sniffed.extension);
          if (isVideo) tempPath = tmpPath("gated");

          const size = await storeStream({
            source,
            key,
            contentType: sniffed.contentType,
            metadata,
            limit: record.max_bytes,
            tempPath,
          });
          assertNotTruncated(part);

          const relativePath = key.replace(/^originals\//, "");
          const resourceType = isVideo ? "video" : isAudio ? "file" : "image";
          const item = {
            key,
            size,
            type: isAudio ? "audio" : resourceType,
            url: deliveryUrl(record.folder, relativePath, resourceType),
          };

          if (isVideo) {
            item.variants = getVariantUrls(relativePath);
            if (record.story === true) {
              item.story = { enabled: true, variants: getStoryUrls(relativePath) };
            }
            const info = await buildVideoDerivatives({
              tempPath,
              key,
              metadata,
              story: record.story,
              log: request.log,
            });
            item.durationSeconds = info.durationSeconds;
          }

          request._logExtra = {
            component: "GatedUploadRoute",
            resource_type: resourceType,
            s3_key: key,
            file_size_bytes: size,
            user_type: record.user_type,
            user_id: record.user_id,
            ticket_jti: record.jti,
            phone: contact.phone,
            email: contact.email,
          };
          return reply.code(201).send(item);
        }

        return reply.code(400).send({ error: "File is required" });
      } catch (err) {
        if (isTooLargeError(err)) {
          return reply.code(413).send({ error: "File exceeds the size limit" });
        }
        throw err;
      } finally {
        if (tempPath) await cleanup(tempPath);
      }
    },
  );

  // ── Bulk upload — images only ────────────────────────────────────────────
  // No probe, no poster, no instant variant, no queue path at all: every video
  // concern lives on the single route instead of two.
  fastify.post(
    "/gated/upload/bulk",
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

      const metadata = attributionMetadata(record);
      const contact = normaliseContact(record);
      const stored = [];
      const skipped = [];

      try {
        for await (const part of request.parts({
          limits: partLimits(record.max_bytes, record.count),
        })) {
          if (part.type !== "file") continue;

          const head = await readHead(part.file, SIGNATURE_BYTES);
          const sniffed = sniff(head);
          const source = prependHead(head, part.file);

          if (isVideoKind(sniffed.kind)) {
            // A bad file is skipped and reported; the rest still store.
            source.resume();
            skipped.push({ filename: part.filename, reason: "video_not_allowed" });
            continue;
          }

          const key = objectKey(record.folder, sniffed.extension);
          const size = await storeStream({
            source,
            key,
            contentType: sniffed.contentType,
            metadata,
            limit: record.max_bytes,
          });
          assertNotTruncated(part);
          stored.push({ key, size });
        }
      } catch (err) {
        if (isTooLargeError(err)) {
          return reply.code(413).send({ error: "File exceeds the size limit" });
        }
        throw err;
      }

      if (stored.length === 0 && skipped.length === 0) {
        return reply.code(400).send({ error: "At least one file is required" });
      }

      request._logExtra = {
        component: "GatedUploadRoute",
        file_count: stored.length,
        skipped_count: skipped.length,
        total_file_size_bytes: stored.reduce((sum, i) => sum + i.size, 0),
        user_type: record.user_type,
        user_id: record.user_id,
        ticket_jti: record.jti,
        phone: contact.phone,
        email: contact.email,
      };

      // Same shape the existing bulk route returns: basenames only.
      const urls = stored.map((i) => path.basename(i.key));
      const body = urls.length > 1 ? { urls } : { url: urls[0] };
      // Only present when something was actually rejected, so the ordinary
      // response is byte-identical to the route this mirrors.
      if (skipped.length) body.skipped = skipped;
      return reply.code(201).send(body);
    },
  );

  // ── Spreadsheet upload ───────────────────────────────────────────────────
  // Returns the storage key only — no public URL. Nobody downloads these
  // through the browser; the consumer reads them from storage.
  fastify.post(
    "/gated/upload/excel",
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

      const metadata = attributionMetadata(record);
      const contact = normaliseContact(record);
      const limit = toInt(process.env.UPLOAD_EXCEL_MAX_FILE_SIZE_MB, 512) * 1024 * 1024;

      try {
        for await (const part of request.parts({
          limits: partLimits(limit, 1),
        })) {
          if (part.type !== "file") continue;

          const ext = path.extname(part.filename || "").replace(".", "").toLowerCase();
          const contentType = EXCEL_CONTENT_TYPES[ext];
          if (!contentType) {
            part.file.resume();
            return reply.code(400).send({
              error: "Only Excel files are allowed (.xlsx, .xls, .xlsm, .xlsb)",
            });
          }

          // The extension names the format; the bytes must agree with the
          // container it implies, so a renamed file is refused.
          const head = await readHead(part.file, SIGNATURE_BYTES);
          const sniffed = sniff(head);
          if (sniffed.kind !== EXCEL_CONTAINER_BY_EXT[ext]) {
            part.file.resume();
            return reply.code(400).send({
              error:
                "File content does not match a valid Excel file (.xlsx, .xls, .xlsm, .xlsb)",
            });
          }

          const source = prependHead(head, part.file);
          const key = objectKey(record.folder, ext);
          const size = await storeStream({
            source,
            key,
            contentType,
            metadata,
            limit,
          });
          assertNotTruncated(part);

          request._logExtra = {
            component: "GatedExcelUploadRoute",
            resource_type: "file",
            s3_key: key,
            file_size_bytes: size,
            user_type: record.user_type,
            user_id: record.user_id,
            ticket_jti: record.jti,
            phone: contact.phone,
            email: contact.email,
          };

          return reply.code(201).send({
            key,
            filename: path.basename(key),
            originalName: part.filename,
            contentType,
          });
        }

        return reply.code(400).send({ error: "File is required" });
      } catch (err) {
        if (isTooLargeError(err)) {
          return reply.code(413).send({ error: "File too large" });
        }
        throw err;
      }
    },
  );
}

module.exports = gatedUploadRoutes;
