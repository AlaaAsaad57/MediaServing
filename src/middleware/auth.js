// Gated paths are decided BEFORE the allowlist below, and on the parsed
// pathname rather than the raw URL. The allowlist tests `request.url`, which
// includes the query string, so a clause placed after it could be stepped around
// with `?x=/image/upload/`. Redemption in the handler is still the authoritative
// check; this hook only decides which door the request is at.
function isGatedPath(pathname) {
  return pathname === "/gated" || pathname.startsWith("/gated/");
}

// Chat attachment delivery is public — the URL is handed to a chat client to
// render directly. Like the gated check above it tests the PARSED pathname and
// sits before the legacy allowlist, so it does not inherit that list's
// query-string weakness. The route itself resolves only inside
// `originals/chat/`, so this opens nothing else.
function isPublicChatFilePath(pathname) {
  return pathname.startsWith("/chat/file/");
}

const { extractMarketToken } = require("../utils/tokenExtractor");

async function authHook(request, reply) {
  const pathname = String(request.url || "").split("?")[0];

  if (request.method === "OPTIONS") return;

  if (isGatedPath(pathname)) {
    // Two cases, and the static API key is accepted in neither.
    //
    //   /gated/ticket  — carries a market access token, no ticket yet.
    //   everything else under /gated/* — must carry an upload ticket and a market access token.
    if (pathname === "/gated/ticket") return;

    const ticket = request.headers["x-upload-ticket"];
    const marketToken = extractMarketToken(request);
    if (!ticket || Array.isArray(ticket) || !marketToken) {
      // Same uniform answer the routes give for a spent or expired ticket, so
      // this hook adds no way to tell the cases apart.
      return reply.code(403).send({ error: "Forbidden" });
    }
    return;
  }

  if (isPublicChatFilePath(pathname)) return;

  // Legacy paths, deliberately UNCHANGED — these still test `request.url`,
  // query string included. That is a known bypass (`POST /upload?x=/image/upload/`
  // skips the key check entirely) and it is an accepted, recorded risk for the
  // migration window, not an oversight: see `plan.md > Out of scope`. It is the
  // cutover ticket's to close, together with the key itself. Do not "fix" it
  // here without changing that decision first.
  if (
    request.url === "/metrics" ||
    request.url === "/health" ||
    request.url.includes("/media/upload/") ||
    request.url.includes("/image/upload/") ||
    request.url.includes("/video/upload/") ||
    request.url.includes("/file/upload/")
  )
    return;

  const apiKey = request.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

module.exports = { authHook };
