# `GET /api/v1/userinfo` — client integration guide

Ask the gateway who owns an access token. You send a bearer token, you get back the identity
behind it and whether that account is allowed to upload files.

Read this if you are calling the endpoint. For *how* the gateway works it out, see
`GO-ME-API-SCENARIOS.md`; for the original requirement, `GO-ME-API-REQUIREMENT.md`.

## Request

```http
GET /api/v1/userinfo
Authorization: Bearer <access token>
```

No body, no query parameters, no other headers. The token is the one the user already
authenticates with — this endpoint accepts customer, guest, admin and seller tokens alike.

## Success — 200

```json
{
  "isSuccessful": true,
  "code": 200,
  "hasContent": true,
  "message": "Data Got!",
  "detailed_error": null,
  "data": {
    "id": 15832,
    "user_type": "customer",
    "is_allowed_to_upload_files": true,
    "phone": "+9647701234567",
    "email": "customer@example.com"
  }
}
```

**Everything you need is under `data`.** The outer envelope is this gateway's house style and is
identical on every endpoint.

| Field | Type | Notes |
|---|---|---|
| `data.id` | integer | The account's id **in its own table**. Never null. See the warning below — it is not unique on its own. |
| `data.user_type` | string | One of five values, listed in the next section. Never null. |
| `data.is_allowed_to_upload_files` | boolean | Never null. Treat anything else — missing, null, non-boolean — as `false`. |
| `data.phone` | string or **null** | Whatever the account has stored. May be a placeholder; see "Guest accounts". |
| `data.email` | string or **null** | Same. |

`phone` and `email` are `null` only when the column itself is empty in the database (possible for
admins and sellers). The keys are always present, so `null` means "no value on record", never
"not implemented".

## The five `user_type` values

| Value | Who it is |
|---|---|
| `guest` | An anonymous visitor. Not signed in with a verified phone. |
| `customer` | A phone-verified shopper — the normal signed-in user. |
| `shop_employee` | A person who works in a seller's shop, signing in as a normal app user. |
| `seller` | A shop owner. *(Not yet reachable — see "Known limitations".)* |
| `admin` | A dashboard administrator. |

The list is generated from the code into Swagger (`constant.UserinfoTypeEnum`), so it cannot drift
from what the endpoint actually returns. Treat an unrecognised value as untrusted and deny.

> ### ⚠️ `id` is not unique on its own
> `customer` 7, `seller` 7 and `admin` 7 are **three different people**. The three account types
> live in separate database tables with independent id sequences. Any record you keep — an upload
> log, a rate-limit bucket, an owner field — must key on the **pair** `(user_type, id)`. Keying on
> `id` alone will merge unrelated people together.

## `is_allowed_to_upload_files`

The gateway's answer to "is this account in good standing to upload at all". It is `false` when:

- the account is a **guest** — always, regardless of anything else; or
- the account is **blocked or inactive** (a deactivated customer, a blocked admin, a seller still
  pending approval).

It is not a complete permission check. It says nothing about file size, type, quota or which
bucket — those stay yours. **Fail closed:** if the field is missing, null, or the request failed
for any reason, deny the upload. Never fall back to allowing it.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| **401** | Token missing, malformed, expired, revoked, or its account no longer exists | Treat as not signed in. Deny the upload. |
| **500** | The gateway or its database failed | Deny the upload. Retrying once is reasonable; do not degrade to "allow". |

A single 401 covers every rejection reason on purpose — the response will not tell you *which*,
and you should not branch on it. The error body is not worth parsing; use the status code.

> **A 401 does not mean "create a guest".** Some other flows in this system auto-register a guest
> when a token is rejected. This endpoint never does, and you must not either — a 401 here means
> the token is not valid, full stop.

## Guest accounts: expect placeholder contacts

A guest row carries filler values the system wrote at registration, and this endpoint returns them
exactly as stored rather than cleaning them up:

```json
{ "id": 15832, "user_type": "guest", "is_allowed_to_upload_files": false,
  "phone": "0", "email": "guest.4f8a…@guest.com" }
```

- `phone` is usually the literal string **`"0"`** — the column cannot be empty, so registration
  writes a placeholder.
- `email` is usually a generated `guest.<random>@guest.com` address.

Neither reaches a human. If you display or store contact details, filter these out on your side.
A guest who verified by OTP but was never promoted to a full account can still show `is_guest`
placeholders here while their real number lives elsewhere in the system.

## Example

```ts
type UserType = 'guest' | 'customer' | 'shop_employee' | 'seller' | 'admin';

interface Userinfo {
  id: number;
  user_type: UserType;
  is_allowed_to_upload_files: boolean;
  phone: string | null;
  email: string | null;
}

async function fetchUserinfo(token: string): Promise<Userinfo | null> {
  const res = await fetch('/api/v1/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Any non-200 — 401, 500, network — means "unknown caller". Fail closed.
  if (!res.ok) return null;

  const body = await res.json();
  return body?.data ?? null;
}

async function mayUpload(token: string): Promise<boolean> {
  const me = await fetchUserinfo(token);
  return me?.is_allowed_to_upload_files === true; // strict: null/undefined ⇒ false
}
```

## Do not cache the response

Call it per upload. Blocking an abusive account, revoking a token, or deactivating a user must take
effect on the **next** request — a cache turns a ban into a delay. The endpoint is two indexed
primary-key lookups, so it is cheap by design.

## Known limitations

- **Seller tokens do not exist yet.** Sellers currently authenticate by session on the PHP side,
  not with an API token, so no seller can reach this endpoint. The `seller` branch is implemented
  and will start working once a `seller-api` Passport guard is added — no client change needed.
- **Admin tokens depend on Passport configuration.** If the admin OAuth client has no `provider`
  set, admin tokens return **401** rather than being misidentified as a customer. If admins get
  401s, that configuration is why.
- **This is not an OpenID Connect endpoint**, despite the path. It does not return OIDC claims
  (`sub`, `phone_number`, `email_verified`). Do not point an OIDC client library at it.