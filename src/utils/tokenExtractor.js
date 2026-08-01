// Utility to extract the market access token from either:
// 1. `Authorization: Bearer <token>` header
// 2. `MARKET-TOKEN` cookie from `Cookie` header

function extractMarketToken(request) {
  if (!request || !request.headers) return null;

  // 1. Check Authorization: Bearer <token>
  const authHeader = request.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // 2. Check Cookie: MARKET-TOKEN=<token>
  const cookieHeader = request.headers.cookie || "";
  if (cookieHeader) {
    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
      const [key, ...valParts] = cookie.trim().split("=");
      if (key && key.trim().toUpperCase() === "MARKET-TOKEN") {
        const val = valParts.join("=").trim();
        if (val) return val;
      }
    }
  }

  return null;
}

module.exports = { extractMarketToken };
