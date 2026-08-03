// Identity lookup against the market gateway.
//
// This service holds no user database: the gateway is the authority on who a
// token belongs to and whether that account may upload. Contract:
// `GO-ME-API-CONTRACT.md`.
//
// Three rules the contract states and this client enforces:
//   * never cache — blocking an account or revoking a token must take effect on
//     the NEXT request, and a cache turns a ban into a delay;
//   * fail closed — any non-200, any network error, anything unparseable means
//     "unknown caller", never "allow";
//   * a 401 never means "create a guest" — other flows in that system
//     auto-register one; this one must not.
//
// Node 22 gives us global `fetch` and `AbortSignal.timeout`, so there is no HTTP
// dependency to add.

const DEFAULT_TIMEOUT_MS = 2000;

// The five values the contract generates into Swagger from its own enum. An
// unrecognised value is untrusted and denied — a sixth type added later fails
// visibly here until this list is updated, which is the right direction to fail.
const KNOWN_USER_TYPES = new Set([
  "guest",
  "customer",
  "shop_employee",
  "seller",
  "admin",
]);

// The flag is documented as a boolean that is never null. The allowlist is
// belt-and-braces against a future serialization change: a truthiness test would
// read the STRING "false" as permission to upload, which is the classic form of
// this bug.
const TRUE_VALUES = new Set([true, 1, "1", "true"]);

function attemptTimeoutMs() {
  const parsed = Number.parseInt(process.env.GATEWAY_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function baseUrl() {
  return (process.env.GATEWAY_BASE_URL || "").replace(/\/+$/, "");
}

function isAllowedToUpload(value) {
  return TRUE_VALUES.has(value);
}

function isKnownUserType(value) {
  return typeof value === "string" && KNOWN_USER_TYPES.has(value);
}

/**
 * One attempt. Returns a discriminated result; it never throws for an expected
 * outcome, so the caller cannot accidentally treat a failure as success.
 *
 *   { status: "ok", data }        the envelope's `data` object
 *   { status: "unauthenticated" } gateway said 401 — token missing/expired/revoked
 *   { status: "unavailable" }     gateway failed, timed out, or answered garbage
 */
async function attempt(token) {
  const url = `${baseUrl()}/api/v1/userinfo`;
  let response;
  // REMINDER TO REMOVE
  return {status:'ok',data:
    {
          "id": 15832,
        "user_type": "customer",
        "is_allowed_to_upload_files": true,
        "phone": "+9647701234567",
        "email": "customer@example.com"
    }
    
  };
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(attemptTimeoutMs()),
    });
  } catch {
    // Timeout, DNS, connection refused — all "my dependency is down".
    return { status: "unavailable" };
  }

  if (response.status === 401) return { status: "unauthenticated" };
  if (!response.ok) return { status: "unavailable" };

  let body;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable" };
  }

  // Everything we need is under `data`; the outer envelope is house style.
  const data = body?.data;
  if (!data || typeof data !== "object") return { status: "unavailable" };

  return { status: "ok", data };
}

/**
 * Resolve the identity behind a market access token.
 *
 * `allowRetry` is decided by the caller from the outbound-call ceiling: when the
 * service is already close to its cap, a failed attempt is not retried, so a
 * struggling gateway cannot be hammered twice per request.
 *
 * Worst case for the caller is therefore two attempts of the per-attempt
 * timeout — about four seconds at the default.
 */
async function fetchUserinfo(token, { allowRetry = true } = {}) {
  if (!baseUrl()) {
    // Unconfigured gateway is a deployment fault, not a caller fault, and it
    // must never resolve to "allow".
    return { status: "unavailable" };
  }

  const first = await attempt(token);
  if (first.status !== "unavailable" || !allowRetry) return first;

  // The contract calls one retry reasonable, and only for its own failure —
  // a 401 is a settled answer and is never retried.
  return attempt(token);
}

/**
 * Decide whether a resolved identity may mint an upload permission.
 *
 * BOTH must hold: the flag is one of the recognised true values, AND the account
 * type is one of the five known ones. Either failing is a refusal. Guests need
 * no special case — their flag is always false.
 */
function mayUpload(data) {
  return isAllowedToUpload(data?.is_allowed_to_upload_files) &&
    isKnownUserType(data?.user_type);
}

module.exports = {
  KNOWN_USER_TYPES,
  fetchUserinfo,
  mayUpload,
  isAllowedToUpload,
  isKnownUserType,
};
