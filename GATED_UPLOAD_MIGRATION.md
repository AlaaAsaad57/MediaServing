# Migrating to the gated upload API

The legacy routes (`POST /upload`, `/upload/bulk`, `/upload/excel`) still work
unchanged — move at your own pace. They go away in a later cutover ticket.

Delivery URLs (`GET /image|video|file/upload/…`) do not change.

## What's different

Uploading is now **two calls**: mint a short-lived permission with the user's
access token, then spend it on the upload. The shared `X-API-Key` is gone.

```
POST /gated/ticket        Authorization: Bearer <user access token>
  → { ticket, expires_in: 120, max_bytes }

POST /gated/upload        X-Upload-Ticket: <ticket>
  → 201 { key, size, type, url, ... }
```

The ticket carries the folder, size cap and file count, so the upload request no
longer sends them. The object name and file type are decided by the server from
the file's bytes — your filename and `Content-Type` are ignored.

## Route map

| Old | New |
|---|---|
| `POST /upload` | `POST /gated/upload` |
| `POST /upload/bulk` | `POST /gated/upload/bulk` |
| `POST /upload/excel` | `POST /gated/upload/excel` |
| — | `POST /gated/chat/upload_file` (new: chat attachments) |

## Three rules to code against

1. **Mint right before you upload.** The ticket lives 120 s.
2. **A ticket is single-use, and a failed upload burns it.** Every retry needs a
   fresh ticket — retry from the mint call.
3. **One ticket per request.** A bulk upload is one request, so one ticket covers
   all its files. Two single uploads need two tickets.

## Minting

```js
const res = await fetch(`${BASE}/gated/ticket`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ folder: "product/descriptors", count: 1, story: false }),
});
const { ticket, max_bytes } = await res.json();
```

All body fields optional (`folder: ""`, `count: 1`, `story: false`).

| Code | Do |
|---|---|
| `401` | send the user back through sign-in |
| `403` | this account may not upload — surface it, don't retry |
| `400` | bad `folder`, or `count` over 50 |
| `429` / `503` | back off and retry |

Folder rules: `/`-separated segments of `[A-Za-z0-9._-]`. No `.`/`..`, no leading
or trailing `/`. Rejected at mint time, so you find out before sending bytes.

## Uploading

```js
const body = new FormData();
body.append("file", file);

const res = await fetch(`${BASE}/gated/upload`, {
  method: "POST",
  headers: { "X-Upload-Ticket": ticket },   // no Content-Type — the browser sets it
  body,
});
```

Drop the `folder` field — it's ignored. Response shape is the same as the legacy
route: `{ key, size, type, url, variants?, story?, durationSeconds? }`.

| Code | Meaning |
|---|---|
| `413` | too large. Nothing was stored |
| `403` | ticket missing, expired or already spent — mint a new one, retry once |
| `503` | service issue, back off |

## Per-route changes that affect your client

**`/gated/upload`**
- Size cap is **100 MB** (10 MB for `story` tickets), up from 10 MB.
- No video duration limit any more (was 60 s).
- Audio is supported: `type: "audio"`.

**`/gated/upload/bulk`**
- **Images only.** Videos are rejected and listed in a `skipped` array; upload
  them one at a time through `/gated/upload`.
- Send exactly the number of files you asked for in `count`, or you get a `413`.
- Response otherwise identical: `{ urls }` or `{ url }`, basenames only.

**`/gated/upload/excel`**
- Same four extensions, same 512 MB cap.
- Response no longer has `url` — use `key`. The download route
  `GET /file/upload/…` is unchanged.

**`/gated/chat/upload_file`** (new)
- One file, no processing. Returns an **absolute** `url` to paste into a message.
- Cap is **25 MB**, not `max_bytes`.
- The ticket's `folder` is ignored — everything lands under `originals/chat/`.
- Served by `GET /chat/file/*` (public, supports Range).

## File types

The bytes decide, not the filename. Images, video and audio render in the
browser; PDFs, spreadsheets and anything unrecognised download instead. SVG and
HTML are deliberately never rendered. Nothing is rejected for its type — an
unknown file uploads fine, it just downloads rather than displays.

## Checklist

- [ ] Get the user's access token where you previously used the API key
- [ ] Add the mint call before each upload
- [ ] Move `folder` / `story` / `count` into the mint body
- [ ] Remove `X-API-Key`, add `X-Upload-Ticket`
- [ ] Handle `401` (re-auth) / `403` (fresh ticket) / `413` / `503` separately
- [ ] Bulk: split videos out
- [ ] Excel: read `key` instead of `url`
