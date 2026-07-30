// Byte sniffing — decide what a file IS from its leading bytes, never from the
// name or the declared type the client sent.
//
// Two things depend on this:
//   * the stored object's extension and Content-Type (D20) — so bytes named
//     `x.html` are not stored, and later replayed, as HTML;
//   * whether the object may be served `inline` at all (D21) — anything not
//     recognised as a safe image or video is served as a download.
//
// There is deliberately NO type allowlist. Recognising a type only decides how
// the object is stored and served; an unrecognised type still uploads, it just
// downloads instead of rendering. That is what makes an allowlist unnecessary.
//
// Implemented here rather than taken from a dependency: this codebase is
// CommonJS and the popular sniffing package is ESM-only, and the set of types
// that must be *recognised* is small precisely because the unrecognised case is
// safe by construction.

const { PassThrough } = require("stream");

// Enough for every signature below. The longest check is the ISO-BMFF `ftyp`
// box, whose brand sits at bytes 8..12.
const SIGNATURE_BYTES = 16;

// kind -> how it is stored and whether it may render in the browser.
const KINDS = {
  jpeg: { extension: "jpg", contentType: "image/jpeg", media: "image", inlineSafe: true },
  png: { extension: "png", contentType: "image/png", media: "image", inlineSafe: true },
  gif: { extension: "gif", contentType: "image/gif", media: "image", inlineSafe: true },
  webp: { extension: "webp", contentType: "image/webp", media: "image", inlineSafe: true },
  avif: { extension: "avif", contentType: "image/avif", media: "image", inlineSafe: true },
  mp4: { extension: "mp4", contentType: "video/mp4", media: "video", inlineSafe: true },
  mov: { extension: "mov", contentType: "video/quicktime", media: "video", inlineSafe: true },
  webm: { extension: "webm", contentType: "video/webm", media: "video", inlineSafe: true },
  // Audio. Recognised so a chat attachment carries a real audio/* type and plays
  // in an <audio> element instead of downloading. Nothing in the transform
  // pipeline handles audio — these types exist for storage and delivery only.
  mp3: { extension: "mp3", contentType: "audio/mpeg", media: "audio", inlineSafe: true },
  m4a: { extension: "m4a", contentType: "audio/mp4", media: "audio", inlineSafe: true },
  wav: { extension: "wav", contentType: "audio/wav", media: "audio", inlineSafe: true },
  flac: { extension: "flac", contentType: "audio/flac", media: "audio", inlineSafe: true },
  ogg: { extension: "ogg", contentType: "audio/ogg", media: "audio", inlineSafe: true },
  // Spreadsheet containers. Recognised so the spreadsheet route can verify them,
  // but never inline — they are downloads by nature.
  zip: { extension: "zip", contentType: "application/zip", media: "file", inlineSafe: false },
  ole2: { extension: "xls", contentType: "application/vnd.ms-excel", media: "file", inlineSafe: false },
  // PDF is recognised so the commonest non-media attachment stores with a real
  // type and extension rather than as `.bin`. Never inline: a PDF rendered on
  // our own origin has a long history as a script-execution vector, and nothing
  // here needs it to render.
  pdf: { extension: "pdf", contentType: "application/pdf", media: "file", inlineSafe: false },
};

// What an unrecognised file becomes: it still stores, it just never renders.
const UNRECOGNISED = Object.freeze({
  kind: null,
  extension: "bin",
  contentType: "application/octet-stream",
  media: "file",
  inlineSafe: false,
  recognised: false,
});

function startsWith(head, bytes, offset = 0) {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// ISO base media format: [size:4]["ftyp"][major brand:4].
function isoBrand(head) {
  if (head.length < 12) return null;
  if (String(head.subarray(4, 8)) !== "ftyp") return null;
  return String(head.subarray(8, 12)).trim().toLowerCase();
}

const ISO_VIDEO_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "mmp4",
  "m4v", "dash",
]);

// The audio members of the same container family. Checked before the video set
// so an .m4a is not stored as video/mp4 — a chat client shown that type renders
// a video player with a black frame instead of an audio control.
const ISO_AUDIO_BRANDS = new Set(["m4a", "m4b", "m4p"]);

/**
 * Identify the container from the leading bytes.
 * Returns a key of KINDS, or null when nothing matches.
 */
function detectKind(head) {
  if (!Buffer.isBuffer(head) || head.length === 0) return null;

  // Images.
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return "gif"; // "GIF8"

  // RIFF carries both WebP and WAV; the form at byte 8 says which.
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46])) { // "RIFF"
    if (startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp"; // "WEBP"
    if (startsWith(head, [0x57, 0x41, 0x56, 0x45], 8)) return "wav"; // "WAVE"
  }

  // ISO base media: AVIF (image), the M4A family (audio), and MP4/MOV (video).
  const brand = isoBrand(head);
  if (brand) {
    if (brand === "avif" || brand === "avis") return "avif";
    if (brand === "qt") return "mov";
    if (ISO_AUDIO_BRANDS.has(brand)) return "m4a";
    if (ISO_VIDEO_BRANDS.has(brand)) return "mp4";
    // Unknown ISO brand: still an ISO container, treat as mp4 rather than
    // unrecognised — the bytes really are a media container.
    return "mp4";
  }

  // Matroska / WebM.
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";

  // Audio containers.
  if (startsWith(head, [0x4f, 0x67, 0x67, 0x53])) return "ogg"; // "OggS"
  if (startsWith(head, [0x66, 0x4c, 0x61, 0x43])) return "flac"; // "fLaC"
  if (startsWith(head, [0x49, 0x44, 0x33])) return "mp3"; // "ID3"

  // Documents.
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // "%PDF-"

  // Spreadsheet containers.
  if (
    startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || // "PK\x03\x04"
    startsWith(head, [0x50, 0x4b, 0x05, 0x06]) || // empty archive
    startsWith(head, [0x50, 0x4b, 0x07, 0x08]) // spanned archive
  ) {
    return "zip";
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "ole2";
  }

  // An untagged MP3 opens on a bare MPEG frame sync — eleven set bits — rather
  // than a magic string. It is tested LAST because that is a two-byte pattern
  // and every real signature above must get its chance first.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return "mp3";
  }

  // SVG is deliberately absent: it is XML that a browser executes, so it is
  // never a "recognised safe image" here (D21).
  return null;
}

/**
 * Describe a file from its leading bytes.
 * Always returns an object; an unknown container yields the UNRECOGNISED shape,
 * which stores fine and is served as a download.
 */
function sniff(head) {
  const kind = detectKind(head);
  if (!kind) return { ...UNRECOGNISED };
  return { kind, ...KINDS[kind], recognised: true };
}

// Content types that may be rendered in the browser. Everything else — an
// unrecognised container, a spreadsheet, and notably SVG and HTML — is served
// as a download instead. The delivery route asks this about the type stored on
// the object, so a file whose bytes were never recognised can never render.
const INLINE_SAFE_CONTENT_TYPES = new Set(
  Object.values(KINDS)
    .filter((k) => k.inlineSafe)
    .map((k) => k.contentType),
);

// Extensions that may render. Used on the DELIVERY side, where the object is
// already stored and only its key is in hand: since the stored extension is
// itself byte-derived (D20), an extension outside this set means the bytes were
// never recognised. Aliases are included because objects stored before this
// ticket carry client-supplied extensions.
//
// This does not re-trust the extension for safety: it only decides which path
// the request takes. The disposition is still set from the stored CONTENT TYPE,
// so a legacy object with a friendly extension but a dangerous stored type still
// downloads rather than rendering.
//
// Audio extensions are deliberately NOT here even though the audio KINDS above
// are `inlineSafe`. The two sets answer different questions: this one gates the
// image route's TRANSFORM path, and an `.mp3` admitted to it would be handed to
// Sharp, which cannot decode it and 500s. Audio is served by the chat route,
// which asks `isInlineSafeContentType` about the stored type instead.
const INLINE_SAFE_EXTENSIONS = new Set([
  "jpg", "jpeg", "jpe", "png", "gif", "webp", "avif",
  "mp4", "m4v", "mov", "webm",
]);

function isInlineSafeExtension(extension) {
  if (!extension) return false;
  return INLINE_SAFE_EXTENSIONS.has(String(extension).toLowerCase());
}

function isInlineSafeContentType(contentType) {
  if (!contentType) return false;
  // Strip any parameters, e.g. "image/jpeg; charset=binary".
  const base = String(contentType).split(";")[0].trim().toLowerCase();
  return INLINE_SAFE_CONTENT_TYPES.has(base);
}

function isVideoKind(kind) {
  return KINDS[kind]?.media === "video";
}

function isImageKind(kind) {
  return KINDS[kind]?.media === "image";
}

function isAudioKind(kind) {
  return KINDS[kind]?.media === "audio";
}

/**
 * Read the first `n` bytes of a Readable without consuming the rest.
 *
 * The stream is left paused with its remaining data intact, so the caller can
 * pipe it onward via `prependHead`. This is what lets the object key be chosen
 * from the bytes *before* the upload starts, while the body still streams.
 */
function readHead(source, n = SIGNATURE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    function cleanup() {
      source.removeListener("readable", onReadable);
      source.removeListener("end", onEnd);
      source.removeListener("error", onError);
    }
    function onReadable() {
      let chunk;
      while ((chunk = source.read()) !== null) {
        chunks.push(chunk);
        length += chunk.length;
        if (length >= n) {
          cleanup();
          resolve(Buffer.concat(chunks));
          return;
        }
      }
    }
    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    function onError(err) {
      cleanup();
      reject(err);
    }

    source.on("readable", onReadable);
    source.on("end", onEnd);
    source.on("error", onError);
  });
}

/**
 * Re-attach an already-read head to the front of its source, giving a stream
 * that yields the whole file again from byte 0.
 */
function prependHead(head, source) {
  const out = new PassThrough();
  if (head && head.length) out.write(head);
  source.pipe(out);
  source.on("error", (err) => out.destroy(err));
  return out;
}

module.exports = {
  SIGNATURE_BYTES,
  KINDS,
  UNRECOGNISED,
  detectKind,
  sniff,
  isInlineSafeContentType,
  isInlineSafeExtension,
  isVideoKind,
  isImageKind,
  isAudioKind,
  readHead,
  prependHead,
};
