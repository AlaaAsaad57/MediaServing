// HTTP Range parsing, shared by every route that serves whole media objects.
//
// Lifted out of the delivery route unchanged when the chat download route needed
// the same behaviour: `<audio>` and `<video>` elements issue Range requests to
// seek, and a route that answers 200 to all of them plays from the start but has
// a dead scrub bar.
//
// Only a SINGLE range is supported. A multi-range request (`bytes=0-9,20-29`)
// is reported invalid rather than partially honoured, because answering it
// correctly means a multipart/byteranges body and no player needs one.

/**
 * Interpret a Range header against a known object length.
 *
 * Returns one of:
 *   { kind: "none" }           no Range header — send the whole object, 200
 *   { kind: "invalid" }        malformed, or more than one range
 *   { kind: "unsatisfiable" }  well-formed but starts past the end
 *   { kind: "partial", ... }   start/end/contentLength plus the two header
 *                              strings the caller needs: `headerValue` for the
 *                              response's Content-Range, `storageRange` for the
 *                              request to S3.
 */
function parseSingleRangeHeader(rangeHeader, totalLength) {
  if (!rangeHeader) return { kind: "none" };
  if (typeof rangeHeader !== "string") return { kind: "invalid" };

  const normalized = rangeHeader.trim().toLowerCase();
  if (!normalized.startsWith("bytes=")) return { kind: "invalid" };

  const rawValue = normalized.slice("bytes=".length);
  if (!rawValue || rawValue.includes(",")) return { kind: "invalid" };

  const [startRaw, endRaw] = rawValue.split("-");
  if (startRaw === undefined || endRaw === undefined) {
    return { kind: "invalid" };
  }

  let start;
  let end;

  if (startRaw === "") {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { kind: "invalid" };
    }

    const effectiveLength = Math.min(suffixLength, totalLength);
    start = Math.max(totalLength - effectiveLength, 0);
    end = totalLength - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalLength) {
      return { kind: "unsatisfiable" };
    }

    if (endRaw === "") {
      end = totalLength - 1;
    } else {
      end = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(end) || end < start) {
        return { kind: "invalid" };
      }
      end = Math.min(end, totalLength - 1);
    }
  }

  return {
    kind: "partial",
    start,
    end,
    contentLength: end - start + 1,
    headerValue: `bytes ${start}-${end}/${totalLength}`,
    storageRange: `bytes=${start}-${end}`,
  };
}

module.exports = { parseSingleRangeHeader };
