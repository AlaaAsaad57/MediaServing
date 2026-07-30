# MediaServing — A Plain-English Guide

This file explains the whole app in simple words: what it is, where it starts,
and what happens in every flow. No jargon unless it is explained first.

---

## 1. What this app is, in one paragraph

You upload a picture or a video once. The app saves that **original** file in
cloud storage and never changes it. Later, when someone asks for a small version,
a cropped version, or a poster image of a video, the app **makes it on the spot**,
saves the result next to the original, and sends it back. The next person who asks
for the exact same thing gets the saved copy instantly. It also handles Excel file
uploads and chat attachments.

Think of it as a private, self-hosted Cloudinary.

---

## 2. The pieces it needs to run

| Piece | What it does | Where it comes from |
|---|---|---|
| **S3 storage** | Holds every file, forever. | Real AWS S3 in production; MinIO locally |
| **Redis** | Short-term memory: locks, rate limits, upload tickets, job queue | `redis` container |
| **Sharp** | The image tool (resize, convert) | npm package |
| **FFmpeg / FFprobe** | The video tool (transcode, grab a frame, read info) | installed in the Docker image, must be on PATH |
| **Loki + Grafana** | Log storage and dashboards | containers, optional |

If FFmpeg is missing, every video job fails. If Redis is down, locks fall back to
in-memory (fine on one server) but **gated uploads stop working on purpose**.

---

## 3. Two programs, not one

The app is **two separate processes**. They share the same code folder but they
run independently.

```
┌────────────────────────┐        ┌──────────────────────────┐
│  src/index.js          │        │  src/worker.js           │
│  the web server        │        │  the background worker   │
│  answers HTTP          │        │  answers the queue       │
│  port 3000             │        │  metrics on port 9091    │
└──────────┬─────────────┘        └────────────┬─────────────┘
           │                                   │
           │       both talk to ──────────────►│
           │                                   │
        ┌──▼───────────────────────────────────▼──┐
        │      S3 storage        +       Redis     │
        └──────────────────────────────────────────┘
```

- `npm run dev` / `npm start` → runs the **web server**.
- `npm run worker` → runs the **background worker**.

If you never start the worker, uploads still succeed and poster images still
appear. The heavy, good-looking video versions simply never get built.

---

## 4. Entry point — what happens when the server boots

**`src/index.js`** is the very first file that runs. It does four things:

1. `require("./config/env")` → loads environment variables.
2. `buildApp()` → builds the whole web server (this is where everything is wired).
3. Listens on port `3000`, on all network interfaces.
4. If listening fails, log the error and exit.

### 4a. Loading the settings (`src/config/env.js`)

It reads `NODE_ENV` (default `development`), then looks for a settings file in
this order and **stops at the first one it finds**:

```
.env.<NODE_ENV>      e.g. .env.development or .env.production
.ev.production       (only when NODE_ENV=production — note the typo in the name)
.env
```

Important detail: it loads **only one file**, not all of them. It also uses
`override: false`, which means **real environment variables always win** over
anything written in the file. That is why docker-compose can set values that beat
the `.env` file.

### 4b. Building the server (`src/app.js` → `buildApp()`)

This function assembles the server in a fixed order. Order matters a lot here.

```
 1. Create Fastify with the logger settings
      - logs are JSON lines
      - every request gets an ID (from X-Request-ID header, or a new UUID)
      - x-api-key and authorization headers are printed as [REDACTED]
      - trustProxy is on, so the real client IP is read from proxy headers

 2. Open a Redis connection just for rate limiting (if RATE_LIMIT_STORE=redis)
      - if it fails, log a warning and keep going

 3. Register CORS
      - allowed headers: Content-Type, X-API-Key, X-Upload-Ticket, Range

 4. Register rate limiting (global)
      - counts per API key ("k:<key>") or per IP ("ip:<ip>")
      - social preview bots (Facebook, Twitter, WhatsApp…) are NOT limited
        on public media GET requests, so link previews never break

 5. Register multipart (file upload parsing), 120 MB hard ceiling

 6. Add the "onRequest" hook   → log "incoming request", stamp start time
    Add the "onResponse" hook  → log "request completed" with duration + status
      (this is why there is exactly ONE log line per finished request)

 7. registerMetrics(app)  → Prometheus timers + the GET /metrics route

 8. Add the auth hook (preHandler) → the door check, see section 5

 9. Add GET /health

10. Register the route groups:
      upload.js       (legacy uploads)
      transform.js    (delivery — the main read route)
      files.js        (Excel upload + download)
      ticket.js       (gated: get permission)
      gatedUpload.js  (gated: use permission)
      chat.js         (chat attachments)

11. Set the global error handler
      ValidationError → 400
      413 → "File too large"
      429 → pass the rate-limit message through
      anything else → log it, return a plain 500

12. Start Redis for locking (non-blocking — the server does not wait)
```

---

## 5. The door check — who is allowed in (`src/middleware/auth.js`)

This runs before **every** request. It decides which of three doors the caller is
standing at.

```
Take the URL and cut off the query string  →  "pathname"

┌─ Is it an OPTIONS request?  ────────────────────► let it through (CORS preflight)
│
├─ Does the pathname start with /gated ? ────────► THE NEW DOOR
│     /gated/ticket        → let it through (it checks its own Bearer token)
│     anything else /gated → must have an X-Upload-Ticket header, else 403
│     ** the static API key is NEVER accepted here **
│
├─ Does the pathname start with /chat/file/ ? ───► public, let it through
│
├─ Is the URL one of the old public paths? ──────► THE OLD DOOR
│     /metrics, /health,
│     any URL containing /media/upload/, /image/upload/,
│     /video/upload/, /file/upload/
│                                                  → let it through
│
└─ Everything else ──────────────────────────────► must have a correct
                                                   X-API-Key header, else 401
```

**A known, deliberate weakness:** the old-door checks test the **whole URL,
including the query string**. So `POST /upload?x=/image/upload/` slips past the
API-key check. This is written down as an accepted risk during the migration
window (see the comment in the file). The new `/gated/*` door tests the parsed
pathname instead, so it does not have this hole. This is why the gated routes
exist: they are the replacement.

---

## 6. Every route in the app

| Method + path | What it is | Who can call it |
|---|---|---|
| `GET /health` | Is the app alive? Also reports if Redis is reachable. | anyone |
| `GET /metrics` | Prometheus numbers | anyone |
| `GET /:resourceType/upload/*` | **The main delivery route.** Serves images and videos. | anyone |
| `POST /upload` | Old single upload | API key |
| `POST /upload/bulk` | Old many-file upload | API key |
| `POST /upload/excel` | Old spreadsheet upload | API key |
| `GET /file/upload/*` | Download a spreadsheet | anyone |
| `POST /gated/ticket` | **Step 1:** trade your login token for an upload permission | Bearer token |
| `POST /gated/upload` | **Step 2:** upload one file | upload ticket |
| `POST /gated/upload/bulk` | Step 2, many images (no videos) | upload ticket |
| `POST /gated/upload/excel` | Step 2, a spreadsheet | upload ticket |
| `POST /gated/chat/upload_file` | Upload a chat attachment | upload ticket |
| `GET /chat/file/*` | Download a chat attachment | anyone |

Note: `/test`, `/compare`, and `/stats` pages were **removed**. They used to print
the API key into unauthenticated HTML.

---

## 7. How files are stored in S3

There are only two shapes of key. Everything follows one of them.

```
originals/<folder>/<uuid>.<ext>          the file you uploaded, never touched
derived/<sha256-hash>/<name>.<ext>       everything the app generated
```

Examples:

```
originals/product/9f2c-…-a1.jpg
originals/chat/3b17-…-e0.mp4
derived/8ac3…f1/9f2c-…-a1.webp          a 300px webp of that photo
derived/44de…09/snapshot.webp           frame at 1s of a video
derived/91bb…7c/poster.webp             pretty poster of a video
derived/2f0a…d3/instant.mp4             quick playable copy
derived/c55e…8b/story/story.mp4         vertical story version
```

**The file name is always a random UUID chosen by the server.** The extension
comes from the file's own bytes, never from the name the caller sent. The only
part the caller can influence is the `<folder>`, and that is checked hard
(letters, numbers, `.`, `_`, `-` only; no `..`, no leading/trailing `/`).

### How the hash is built (`src/utils/hashGenerator.js`)

```
input  = "<original key>|<params sorted alphabetically>"
hash   = sha256(input)
key    = derived/<hash>/<basename>.<output format>
```

Because the params are **sorted alphabetically first**, `w_300,h_300` and
`h_300,w_300` produce the **same** key. One cached file, not two.

**Warning:** if you change a preset (say the story video width), the hash changes,
so the app stops finding the old files. They are not overwritten — they are
orphaned and just sit there wasting space.

---

## 8. Flow by flow

### FLOW A — Serving an image

`GET /image/upload/w_300,h_200,c_fill/product/photo.jpg`

```
1. Split the wildcard part after "upload/".
   Walk segment by segment. A segment counts as "transformations" only if
   EVERY comma-piece is a known key (w_, h_, q_, f_, c_, b_, vc_, so_, eo_, fl_).
   The first segment that fails this test — and everything after it — is the
   file path.
      → transformations = ["w_300,h_200,c_fill"]
      → file path       = "product/photo.jpg"

2. Is it a video? Decided by the file extension (.mp4, .mov, .webm, …).
   "media" as the resource type means "figure it out yourself".
   Here it is an image.

3. Is the extension one we are willing to render inline?
   (jpg, jpeg, png, gif, webp, avif, mp4, m4v, mov, webm)
   If NO → skip all processing, stream the original back as a DOWNLOAD.
   This is the safety net: an SVG or an HTML file can never render on our domain.

4. Pick the output format:
      normal browser  → webp   (always, even if you asked for jpg)
      social crawler  → jpg    (Facebook, WhatsApp, Twitter etc. prefer it)
   Turn q_auto into a real number NOW (auto=75, eco=45, low=55, best=85),
   because the cache key must be a fixed value.

5. No params at all?  → just send the original.

6. Build the derived key from originals/product/photo.jpg + params.

7. ┌ Is it already in the cache (does that S3 object exist)?
   │    YES → send it. Header: X-Cache: HIT
   │
   │    NO  → try to take a LOCK on the derived key
   │            (Redis SET NX EX 30 — one winner, expires after 30 seconds)
   │
   │          Lost the lock? → someone else is building it right now.
   │              Sleep 2 seconds, look in the cache again.
   │              Found it  → send it.
   │              Still not → return 503 "try again shortly".
   │
   │          Won the lock?
   │              → check the cache AGAIN (they may have just finished)
   │              → fetch originals/product/photo.jpg
   │                    missing → 404
   │              → run Sharp: resize + convert
   │              → save the result to the derived key
   │              → send it. Header: X-Cache: MISS
   │              → release the lock (always, even on error)
   └
```

Every response gets `Cache-Control: public, max-age=1 year, immutable`, so
browsers and CDNs keep it forever. That is safe because the key is a hash — if the
content would change, the key changes too.

### FLOW B — Serving a video

`GET /video/upload/product/clip.mp4?target=preview`

The big rule: **for videos, all URL transformation parameters are ignored.**
The only thing that matters is `?target=`.

| `?target=` | What you get | Range requests? |
|---|---|---|
| *(omitted)* | `full` — 1280×630 mp4, quality 80 | yes |
| `preview` | 400×600 mp4, first 6 seconds | yes |
| `snapshot` | one frame at 1 second, as webp | no |
| `webp` | a nicer poster image, 720px wide webp | no |
| `story` | 540×960 vertical mp4 | yes |
| `story-fallback` | 360×640 vertical mp4, for weak networks | yes |

Anything else → 400 Bad Request.

```
1. Work out the derived key for the target. Each target has its own key.

2. Already cached?
      YES → stream it straight from S3 to the client.
            If the browser sent a "Range: bytes=…" header, ask S3 for only
            those bytes and answer 206 Partial Content.
            ** Streamed, not loaded into memory. ** A 100 MB video watched by
            10 people would otherwise be 1 GB of RAM.

3. NOT cached, and the target is a VIDEO target (full/preview/story/…):
      → NEVER transcode inside the request. That would take minutes.
      → Instead:
          a) put a job on the queue (the worker will build the good version)
          b) look for the "instant" copy — a quick, normalised mp4
          c) if there is no instant copy, use the ORIGINAL file
          d) stream that back right now with X-Cache: PENDING
             and a SHORT cache time (5 seconds) so the viewer picks up the
             polished version soon after it exists

4. NOT cached, and the target is snapshot or webp (a poster picture):
      → these are cheap, so build them here and now
      → same lock dance as images: lock → re-check → fetch → build → save
```

### FLOW C — Old upload (`POST /upload`)

Needs `X-API-Key`. Limits: images 10 MB, videos 10 MB, video length 60 s.

```
1. Read all the multipart parts into memory FIRST.
   Why: the "folder" field may come after the file, and we need it before
   we can choose the key.

2. No file at all      → 400
   Empty file          → 400
   Over the size limit → 413
   (The limit is chosen from what the BYTES say the file is, not from the
   name — so a video renamed to .jpg cannot borrow the image limit.)

3. Sniff the bytes → decide the extension, the content type, image vs video.
   Choose the key:  originals/<validated folder>/<uuid>.<ext>
   Save it.

4. If it is an IMAGE → done. Return 201 with the URL.

5. If it is a VIDEO:
      a) ffprobe it. Unreadable → 400. Longer than 60 s → 400.
      b) Build the snapshot and the webp poster RIGHT NOW (they are cheap,
         and image-style URLs need them immediately).
         If this fails, log it and carry on — not fatal.
      c) Will this video play in a browser as-is?
         (container mp4/webm + codec h264/vp8/vp9/av1 + audio aac/opus/mp3)
         If NO → build the "instant" copy now so playback is not broken.
      d) Put the heavy job on the queue and return WITHOUT waiting.

6. Return 201 with { key, size, type, url, variants, durationSeconds }.
```

`POST /upload/bulk` is the same, once per file, and returns only the base file
names (no folder), not full URLs.

Special case: uploading to the folder `customers/profile` returns a bare
`/<path>` URL instead of `/image/upload/<path>`.

### FLOW D — The gated upload (the new, safer way)

This replaces the single shared API key with a **two-step handshake**.

```
STEP 1 — get permission
────────────────────────
POST /gated/ticket
Authorization: Bearer <the user's login token from the market gateway>
Body: { "folder": "product", "count": 3, "story": false }

  1. No Bearer token → 401.

  2. Three separate brakes, checked in this order:
       - the rate-limit plugin, keyed on a hash of the token
       - a per-connection counter (default 120/min)     → 429 if over
       - a service-wide ceiling on calls out to the gateway (600/min) → 503
     Reason: without brake 2 and 3, someone could rotate tokens and turn
     this route into an amplifier pointed at the gateway.

  3. Ask the gateway: GET <GATEWAY_BASE_URL>/api/v1/userinfo
       - 2-second timeout, at most one retry
       - NEVER cached: a ban must take effect on the next request
       - 401 from the gateway → 401 to the caller. It never creates a guest.
       - anything else broken → 503. It never means "allow".

  4. Is this account allowed to upload?
     BOTH must be true:  is_allowed_to_upload_files is truthy
                    AND  user_type is one of guest/customer/shop_employee/
                         seller/admin
     Otherwise → 403.

  5. Check the folder. Bad folder → 400.
     Too many files requested → 400.

  6. Mint the ticket:
       - 32 random bytes, base64url
       - stored in Redis for 120 SECONDS
       - the record holds: user type, user id, folder, byte cap,
         file count, story flag, a ticket id (jti), and a contact snapshot
       - the byte cap is 100 MB normally, 10 MB for story uploads

  7. Return { ticket, expires_in: 120, max_bytes }.


STEP 2 — use it
────────────────
POST /gated/upload
X-Upload-Ticket: <the ticket>
(multipart body with the file)

  1. Redeem the ticket. This is ONE atomic Redis transaction
     (MULTI → GET → DEL → EXEC), so two requests racing with the same ticket
     cannot both win. Exactly one gets the record; the other gets nothing.

  2. Missing / expired / already used ticket → 403 "Forbidden".
     ** Always the same message, no sub-codes. ** Different messages would
     let an attacker probe which tickets exist.
     Redis unreachable → 503. There is NO in-memory fallback on purpose:
     a memory map cannot enforce "use once" and would break silently with
     two servers.

  3. Read just the first 16 bytes of the incoming stream to identify the
     file, then glue those bytes back onto the front and keep streaming.
     This is how the key can be chosen from the content BEFORE the upload
     finishes, with nothing held in memory.

  4. Stream the bytes to S3 through a counting guard.
     Over the cap → error mid-stream → the multipart upload is aborted →
     NOTHING is stored → 413.
     (The multipart plugin's own limit is set slightly HIGHER on purpose,
     because that plugin silently truncates instead of failing, which would
     store a broken file and report success.)

  5. Stamp the object with S3 metadata:
     user-type, user-id, ticket-jti, uploaded-at.
     Logs expire; objects do not. This keeps the file traceable to a person.

  6. If it is a video, the same stream was also written to a temp file on
     the way past. Use that file to probe it and build the posters — no
     buffer is ever built. Then queue the heavy work and delete the temp file.

  7. Return 201 with the same shape the old route returns.
```

Differences from the old route, at a glance:

| | Old `/upload` | New `/gated/upload` |
|---|---|---|
| Auth | one shared API key | per-user, single-use ticket |
| Ticket life | — | 120 seconds |
| Size cap | 10 MB | 100 MB (10 MB for stories) |
| Memory | whole file in RAM | streamed, flat memory |
| Who uploaded? | unknown | stamped on the object |
| Folder chosen | at upload time | at ticket time, then locked |

`/gated/upload/bulk` is **images only** — a video part is skipped and reported in
a `skipped` list, so one bad file does not fail the whole batch.

### FLOW E — The background worker

```
Something calls enqueueVideoJob(...). Three things do:
     - the upload routes, after storing a video
     - the delivery route, when a video variant is missing
     - the backfill script (npm run preprocess-videos)

The job goes onto the BullMQ queue named "video-processing" in Redis.
     jobId = the original's S3 key  → duplicate jobs collapse into one
     3 attempts, exponential backoff starting at 2 s
     deleted on success; kept 24 h on failure
     the enqueue itself has a 3-second timeout, and a failure is only logged
     (an upload must never fail because the queue is slow)

src/worker.js picks it up:
     - 2 jobs at a time (VIDEO_JOB_CONCURRENCY)
     - inside one job, up to 4 encodes at a time (VIDEO_PREPROCESS_CONCURRENCY)
       ** these are two different settings on purpose — one number for both
          would multiply the number of live ffmpeg processes, not cap it **
     - each job gets 5 minutes; each ffmpeg gets 2 minutes then SIGKILL

For a normal video it builds:  instant (only if needed), preview, full
For a story video it builds:   story, story-fallback

Each result is written to its derived key. Anything already there is skipped.
If any part fails, the whole job fails and is retried.
```

### FLOW F — Excel / spreadsheet

```
POST /upload/excel?folder=reports          (old route, API key)
POST /gated/upload/excel                   (new route, ticket)

  1. The extension must be .xlsx, .xls, .xlsm or .xlsb.
     Browsers report inconsistent content types for Office files, so the
     extension is the first gate.

  2. The BYTES must match what that extension implies:
        xlsx / xlsm / xlsb  →  a ZIP archive  ("PK\x03\x04")
        xls                 →  an OLE2 file   (D0 CF 11 E0 …)
     A renamed file is refused with 400.
     The old route checks this in a pass-through stream WHILE uploading,
     so a bad file aborts the S3 upload and leaves nothing behind.

  3. Streamed straight to S3 in 8 MB parts. Default cap: 512 MB.

  4. Old route returns a public URL. New route returns only the storage key,
     because nobody downloads these through a browser.

GET /file/upload/<path>
  Public. Streams the file back as an attachment (always a download).
```

### FLOW G — The Chat API

This is the simplest route family in the app, and on purpose. A chat attachment
is **stored and handed back, and that is all**: no resizing, no probing, no
poster, no queue, no worker. The bytes go from the request socket, through a
counting guard, into S3 — and are never held whole in memory. So the cost of this
route stays flat no matter how big the file is.

It is two halves of one decision, which is why they live in the same file
(`src/api/chat.js`):

```
   POST /gated/chat/upload_file   → needs a ticket → returns a URL
   GET  /chat/file/*              → public         → serves that URL
```

The upload's only product is a URL the download route has to honour. The prefix,
the key layout and the render-vs-download rules are one decision. Splitting them
across two files would let them drift apart.

#### G.1 — Why the download side can be public

Look at the key this route builds:

```
originals/chat/<uuid>.<ext>
          ^^^^  ^^^^^^ ^^^^^
          fixed  server extension
          prefix  UUID   from the bytes
```

**Every part is chosen by the server.** In particular, the ticket's bound
`folder` is deliberately **ignored** here. On the other gated routes the folder is
the one thing the caller can influence; on this route there is nothing at all.

That is exactly what makes `GET /chat/file/*` safe to leave open: it hard-prefixes
`originals/chat/`, so a request can never walk out into the rest of the bucket.
A chat message is meant to be pasted and rendered by whoever opens the thread, so
requiring a key on the download would defeat the point.

#### G.2 — Upload: `POST /gated/chat/upload_file`

**Request**

```http
POST /gated/chat/upload_file HTTP/1.1
X-Upload-Ticket: <ticket from POST /gated/ticket>
Content-Type: multipart/form-data; boundary=…

(one file part)
```

You still need a ticket, and you get it exactly the same way as any other gated
upload — see Flow D, Step 1. Nothing about this route changes the handshake.
The static `X-API-Key` is **never** accepted here.

**What happens, in order**

```
1. Redeem the ticket (one atomic Redis GET+DEL, single use).
     no ticket / expired / already spent → 403 "Forbidden"
     Redis unreachable                   → 503 "Service unavailable"

2. Work out the byte cap. THE TIGHTER OF THE TWO WINS:
     - this route's own cap  (CHAT_UPLOAD_MAX_FILE_SIZE_MB, default 25 MB)
     - the cap the ticket already promised (100 MB, or 10 MB for a story ticket)
   Why its own cap at all: a chat attachment is not a media upload, and the
   ceiling that suits a source video is the wrong one to leave open on a
   route that anyone signed in can reach.

3. Read the first 16 bytes to identify the file, then glue them back on the
   front and keep streaming. The type comes from the BYTES — never from the
   filename, never from the Content-Type the client declared.

4. Build the key:  originals/chat/<uuid>.<ext>

5. Stream to S3 through the counting guard.
     over the cap → error mid-stream → upload aborted → NOTHING stored → 413

6. Stamp S3 metadata on the object:
     user-type, user-id, ticket-jti, uploaded-at
     plus original-name, if the caller's filename survives cleaning (see G.4)

7. Return 201.
```

**Response — 201 Created**

```json
{
  "url":          "https://media.example.com/chat/file/3b17c9de-….mp4",
  "key":          "originals/chat/3b17c9de-….mp4",
  "filename":     "3b17c9de-….mp4",
  "originalName": "holiday clip.MP4",
  "contentType":  "video/mp4",
  "size":         8412773,
  "type":         "video"
}
```

- `url` is **absolute**, because a chat client renders it directly. It is built
  from `MEDIA_PUBLIC_BASE_URL` (or `PUBLIC_BASE_URL`); if neither is set, it is
  derived from the request itself — `trustProxy` is on, so `https` survives a
  proxy and the `Host` header carries any non-default port.
- `type` is one of `image`, `video`, `audio`, or `file`.
- `originalName` is the raw name the caller sent, echoed back untouched.
  The **cleaned** version is what gets stored as metadata.

**Errors**

| Code | Meaning |
|---|---|
| 400 | no file part in the body |
| 403 | ticket missing, expired, or already used — always this same message |
| 413 | over the size cap; nothing was stored |
| 429 | rate limited (20/min per user, `GATED_UPLOAD_RATE_LIMIT_MAX`) |
| 503 | Redis (the ticket store) is unreachable |

#### G.3 — Download: `GET /chat/file/<filename>`

Public. No key, no ticket.

```
1. Clean the path. REFUSED OUTRIGHT (not normalised away):
      ".." or an empty segment, a backslash, a NUL byte
   Nothing is left for an attacker to be clever with encoding.
      bad path → 400

2. HEAD the object first, to learn its size.
   The total length is what makes a Range answerable at all, and doing HEAD
   first means a miss costs no body transfer.
      not found → 404

3. Always set:
      Accept-Ranges: bytes            (a player checks for this before it
                                       will even let the user scrub)
      X-Content-Type-Options: nosniff
      Cross-Origin-Resource-Policy: cross-origin
      ETag                            (if S3 gave one)
      Cache-Control: public, max-age=1 year, immutable
        — safe because the key is a UUID and the object is never rewritten

4. Handle the Range header BEFORE the body headers, so a bad range comes back
   as plain JSON rather than an empty response wearing a video content type.
      no Range        → 200, whole file
      valid Range     → 206 + Content-Range, only those bytes fetched from S3
      broken Range    → 416 + "Content-Range: bytes */<size>"
   Only ONE range is supported. "bytes=0-9,20-29" is treated as invalid,
   because answering it properly needs a multipart body and no player wants one.

5. Decide render vs. download FROM THE STORED CONTENT TYPE — which was itself
   derived from the bytes at upload:
      image / video / audio  → Content-Disposition: inline   (plays in place)
      everything else        → Content-Disposition: attachment; filename="…"
   The download name is the cleaned original-name metadata, falling back to
   the UUID.

6. Stream the body straight from S3. Never buffered: a popular attachment
   must not become its own size in RAM for every concurrent reader.
```

#### G.4 — The filename, and why it gets cleaned

The stored object is named with a UUID, so the caller's filename is kept purely
so a downloaded file has something human on disk. It is stored as S3 user
metadata — and **S3 user metadata travels in HTTP headers**, so it must be ASCII.
A non-ASCII value would make the PUT itself fail.

So the name is cleaned rather than mangled:

```
strip the directory part           "C:\stuff\تقرير final.pdf" → "تقرير final.pdf"
drop every non-printable-ASCII     → " final.pdf"
drop quotes and backslashes        → (they get interpolated into
                                      Content-Disposition; a quote there
                                      would break out of the filename)
trim, then cut to 100 characters
```

If nothing survives, no metadata is written and the download simply uses the UUID.

#### G.5 — What a chat attachment is allowed to be

There is **no allowlist**. Anything uploads. What changes is how it is stored and
whether it may render:

| The bytes say | Stored as | In the browser |
|---|---|---|
| JPEG, PNG, GIF, WebP, AVIF | `image/*` | renders |
| MP4, MOV, WebM | `video/*` | plays |
| MP3, M4A, WAV, FLAC, OGG | `audio/*` | plays in an `<audio>` control |
| PDF | `application/pdf` | **downloads** |
| ZIP, XLS | their real type | **downloads** |
| anything unrecognised | `.bin`, `application/octet-stream` | **downloads** |

Two deliberate choices in that table:

- **PDF is recognised but never inline.** A PDF rendered on our own origin has a
  long history as a script-execution vector, and nothing here needs it to render.
- **SVG is absent entirely.** It is XML that the browser executes, so it is never
  treated as a "safe image" — it lands in the unrecognised row and downloads.

Audio deserves a note: the sniffer checks the M4A brands (`m4a`, `m4b`, `m4p`)
*before* the MP4 video brands. Without that, a voice note would be stored as
`video/mp4`, and a chat client shown that type draws a video player with a black
frame instead of an audio control.

#### G.6 — Rate limits

| Route | Default | Keyed by |
|---|---|---|
| `POST /gated/chat/upload_file` | 20/min | the user (`user_type:user_id` from the ticket), falling back to the connection IP |
| `GET /chat/file/*` | 600/min | API key or IP, the global rule |

Delivery is much looser on purpose: opening one chat thread can pull many
attachments, plus a Range request for every seek in a video.

#### G.7 — How the chat routes differ from the other gated routes

| | `/gated/upload` | `/gated/chat/upload_file` |
|---|---|---|
| Ticket needed | yes | yes |
| Folder | from the ticket | **ignored** — always `chat/` |
| Size cap | 100 MB (10 MB story) | min(25 MB, ticket cap) |
| Video handling | probe, posters, queue a job | none at all |
| Audio | not really a case | first-class |
| Returns | a delivery URL, plus variants | one absolute URL |
| Its download route | `/image|video/upload/*` | `/chat/file/*` |

#### G.8 — Try it

```bash
# 1. get a permission (120 seconds, one use)
TICKET=$(curl -s -X POST https://media.example.com/gated/ticket \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .ticket)

# 2. send the file
curl -X POST https://media.example.com/gated/chat/upload_file \
  -H "X-Upload-Ticket: $TICKET" \
  -F 'file=@voice-note.m4a'
# → 201 { "url": "https://media.example.com/chat/file/….m4a", "type": "audio", … }

# 3. read it back — no auth needed
curl -I  https://media.example.com/chat/file/….m4a
curl -H 'Range: bytes=0-1023' https://media.example.com/chat/file/….m4a   # → 206
```

Remember: the ticket is gone the moment step 2 runs. **One file per ticket.**
Sending three attachments means calling `/gated/ticket` three times.

---

## 9. The safety rules, and why each one exists

| Rule | Why |
|---|---|
| The **bytes** decide the type, never the file name or the declared type | Stops `evil.jpg` that is really HTML from being stored and later executed on our domain |
| Unrecognised files still upload — they just always download | Means we need no allowlist; the unknown case is safe by construction |
| SVG is deliberately **not** a "safe image" | SVG is XML that the browser executes |
| The file name is always a server UUID | The caller has no say in the key except the folder |
| Folder names are checked with a strict pattern | No `../` escape out of `originals/` |
| The gated 403 message is always identical | No way to probe which tickets exist |
| Tickets die after 120 s and can be used once | A leaked ticket is worth almost nothing |
| No in-memory fallback for tickets | A memory map cannot enforce "use once" and breaks with 2 servers |
| Identity is never cached | A ban takes effect on the next request, not after a cache expires |
| Any gateway failure = deny | Failing open would be a silent authentication bypass |
| Videos are streamed, never buffered, on delivery | 100 MB × 10 viewers would otherwise be 1 GB of RAM |
| The size guard counts bytes as they arrive | The multipart plugin truncates silently instead of failing |

---

## 10. Settings you will actually touch

```
# Storage
S3_ENDPOINT / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET
    In production the custom endpoint is NOT set — it assumes real AWS S3.

# Redis
REDIS_URL   (redis://host:6379)   or  host + REDIS_PORT + REDIS_PASS

# Auth
API_KEY              the old shared key
GATEWAY_BASE_URL     where /api/v1/userinfo lives
GATEWAY_TIMEOUT_MS   default 2000

# Size limits
IMAGE_MAX_FILE_SIZE_MB          10
VIDEO_MAX_FILE_SIZE_MB          10
MAX_VIDEO_DURATION_SECONDS      60
UPLOAD_EXCEL_MAX_FILE_SIZE_MB   512
CHAT_UPLOAD_MAX_FILE_SIZE_MB    25

# Public URLs handed back to clients
MEDIA_PUBLIC_BASE_URL   used by the chat upload for its absolute URL
PUBLIC_BASE_URL         fallback for chat; used by the Excel upload
    If neither is set, the URL is built from the request itself.

# Video presets — CHANGING ANY OF THESE ORPHANS THE EXISTING CACHE
FULL_VARIANT_TRANSFORM          w_1280,h_630,f_mp4,vc_h264,q_80,c_fit
PREVIEW_VARIANT_TRANSFORM       w_400,h_600,f_mp4,vc_h264,q_65,c_fill
STORY_VARIANT_TRANSFORM         w_540,h_960,f_mp4,vc_h264,q_54,c_fit
INSTANT_VARIANT_TRANSFORM       w_720,h_1280,f_mp4,vc_h264,q_50,c_fit

# Speed vs quality
VIDEO_JOB_CONCURRENCY           2   (how many jobs at once — worker only)
VIDEO_PREPROCESS_CONCURRENCY    4   (how many encodes inside ONE job)
FFMPEG_THREADS                  2
FFMPEG_X264_PRESET              veryfast
VIDEO_FFMPEG_TIMEOUT_MS         120000
VIDEO_JOB_TIMEOUT_MS            300000

# Rate limits (requests per minute)
RATE_LIMIT_MAX                  120   global
UPLOAD_RATE_LIMIT_MAX           20
UPLOAD_BULK_RATE_LIMIT_MAX      100
TRANSFORM_RATE_LIMIT_MAX        120
TICKET_RATE_LIMIT_MAX           30
GATED_UPLOAD_RATE_LIMIT_MAX     20
CHAT_FILE_RATE_LIMIT_MAX        600
```

---

## 11. Reading the logs

One JSON line per finished request, from the `onResponse` hook. The useful fields:

```
status_code     200 / 404 / 503 …
duration_ms     how long it took
component       which part answered: TransformRoute, UploadRoute,
                GatedUploadRoute, ChatFileRoute, ErrorHandler …
cache_status    HIT | MISS | PENDING | BYPASS | NOT_FOUND | PROCESSING | ERROR
transformed     warm  = it was cached (HIT)
                cold  = it had to be built (MISS)
                pending = serving a fallback while the worker catches up
                bypass  = anything else (do not count it either way)
video_target    snapshot / preview / webp / story / full
user_type,
user_id,
ticket_jti      only on gated uploads — who did it
```

The `transformed` field exists so the Grafana cache-ratio query can filter
`transformed =~ "warm|cold"` and not have errors or bypasses pollute the numbers.

---

## 12. Common things that go wrong

| Symptom | Most likely cause |
|---|---|
| Video plays but looks rough, never improves | The worker is not running |
| `503 Processing in progress` | Another request holds the lock; it expires after 30 s |
| `403 Forbidden` on a gated upload | Ticket expired (120 s), already used, or missing |
| `503 Service unavailable` on `/gated/*` | Redis is down, or the gateway is unreachable |
| Cache suddenly all cold | A preset changed → every hash changed |
| Image URL returns a download | The extension is not in the inline-safe list |
| `500` on `/metrics` scrape | Almost always the worker-metrics merge; it is designed to fail quietly |
| Upload works locally, 401 in prod | `.env.production` not found — only ONE env file is loaded |

---

## 13. The one-page summary

```
UPLOAD                                    DELIVER
──────                                    ───────
POST /gated/ticket                        GET /image/upload/w_300/x.jpg
   ↓ (gateway says who you are)              ↓
   ticket, 120 s, single use               is it cached?
   ↓                                          ├─ yes → send it (HIT)
POST /gated/upload                            └─ no  → lock → build → save
   ↓                                                   → send it (MISS)
sniff bytes → pick key → stream to S3
   ↓                                       GET /video/upload/x.mp4?target=full
image? done.                                  ↓
video? → posters now (cheap)               is it cached?
       → queue the rest (heavy)               ├─ yes → stream it (HIT)
                                              └─ no  → queue the job,
                                                       stream the instant copy
       ┌─────────────────┐                             or the original (PENDING)
       │ worker.js       │
       │ builds preview, │
       │ full, story     │
       └─────────────────┘


CHAT (the simple one — no processing at all)
────────────────────────────────────────────
POST /gated/ticket                        GET /chat/file/<uuid>.<ext>
   ↓                                          ↓  (public, no auth)
POST /gated/chat/upload_file               HEAD it for the size
   ↓  sniff bytes                             ↓
originals/chat/<uuid>.<ext>                Range? → 206 : 200
   ↓                                          ↓
returns ONE absolute URL                   image/video/audio → plays inline
                                           anything else     → downloads
```

---

## 14. Small glossary

- **Original** — the exact file you uploaded. Never modified.
- **Derived / variant** — anything the app generated from an original.
- **Cache-aside** — look in the cache; if it is not there, make it and put it there.
- **Lock** — a "I am building this, please wait" note in Redis. Expires in 30 s.
- **Ticket** — a short-lived, one-use upload permission stored in Redis.
- **Sniffing** — reading the first few bytes to work out what a file really is.
- **Range request** — the browser asking for only part of a file, so you can
  skip forward in a video. Answered with status 206.
- **Poster / snapshot** — a still picture taken from a video.
- **Instant variant** — a quick, rough mp4 made only when the source will not
  play in a browser as-is.
- **Story** — a tall, vertical video format (like Instagram stories).
- **BullMQ** — the job queue library that runs on top of Redis.
