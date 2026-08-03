# Gated Upload API Migration Guide

Media uploads require a **two-step flow**:
1. **Mint Ticket**: Request a short-lived permission ticket using the user's access token (`POST /gated/ticket`).
2. **Upload File**: Upload the file(s) using the issued ticket (`X-Upload-Ticket: <ticket>`).

---

## 1. Step 1: Mint Ticket (`POST /gated/ticket`)

### Required Headers
- `Authorization: Bearer <user_access_token>`
- `Content-Type: application/json`

> **Note on `401 Unauthorized`**: If minting returns `401`, the user's access token is missing or expired. Handle `401` using your client application's own refresh-token / re-authentication flow (e.g., refresh access token or prompt user to log in). The media service has no knowledge of your client authentication flow.

### Request Body (`application/json`)
All body fields are optional:
```json
{
  "folder": "product/descriptors",
  "count": 1,
  "story": false
}
```
- `folder` *(string, optional, default `""`)*: Directory path of `/`-separated `[A-Za-z0-9._-]` segments. No leading/trailing `/`, no `.` or `..`.
- `count` *(number, optional, default `1`, max `50`)*: Number of files expected (for bulk uploads).
- `story` *(boolean, optional, default `false`)*: Set `true` for story uploads (caps max file size at 10 MB).

### Response Shapes
- **`201 Created`**:
```json
{
  "ticket": "opaque_ticket_string",
  "expires_in": 120,
  "max_bytes": 104857600
}
```
*(Note: `max_bytes` is `104857600` [100 MB] default, or `10485760` [10 MB] if `story: true`).*

- **Errors**:
  - `401`: Unauthorized (run client refresh/login flow).
  - `403`: Forbidden (user account not authorized to upload).
  - `400`: Bad Request (invalid `folder` or `count > 50`).
  - `429` / `503`: Rate limit or service unavailable (retry with backoff).

---

## 2. Step 2: Upload Endpoints

### Core Rules
- **Header**: Pass `X-Upload-Ticket: <ticket>` on all gated upload calls.
- **Content-Type**: Send `multipart/form-data`. (Do **not** set `Content-Type: application/json`; let the browser/client set the multipart boundary header automatically).
- **Single-Use Ticket**: Tickets expire in **120 seconds** and are **single-use**. Every retry requires minting a new ticket.
- **Bound Scope**: `folder`, `count`, and `story` settings are bound to the ticket at minting — upload body fields like `folder` are ignored.

---

### A. Single File Upload (`POST /gated/upload`)

Upload a single image, video, audio, or document file.

#### Headers & Body
- Header: `X-Upload-Ticket: <ticket>`
- Body: `multipart/form-data` with file field `file`.

#### Response Shapes (`201 Created`)
- **Standard File / Image / Audio**:
```json
{
  "key": "originals/product/uuid.png",
  "size": 123456,
  "type": "image",
  "url": "/image/upload/product/uuid.png"
}
```
*(Note: `type` can be `"image"`, `"video"`, `"audio"`, or `"file"`).*

- **Video Upload**:
```json
{
  "key": "originals/product/uuid.mp4",
  "size": 1048576,
  "type": "video",
  "url": "/video/upload/product/uuid.mp4",
  "variants": {},
  "durationSeconds": 45.2,
  "story": { "enabled": true, "variants": {} }
}
```
*(`story` present only when minted with `story: true`).*

#### Errors
- `400`: `{ "error": "File is required" }`
- `403`: `{ "error": "Forbidden" }` (Ticket missing, expired, or already spent)
- `413`: `{ "error": "File exceeds the size limit" }`
- `503`: `{ "error": "Service unavailable" }`

---

### B. Bulk Image Upload (`POST /gated/upload/bulk`)

Upload multiple images in one request (images only; videos are skipped).

#### Headers & Body
- Header: `X-Upload-Ticket: <ticket>`
- Body: `multipart/form-data` containing `file` parts matching the minted `count`.

#### Response Shapes (`201 Created`)
- **Single Image Stored**:
```json
{
  "url": "uuid.png"
}
```
- **Multiple Images Stored**:
```json
{
  "urls": [
    "uuid1.png",
    "uuid2.png"
  ]
}
```
- **With Skipped Videos**:
```json
{
  "urls": [
    "uuid1.png"
  ],
  "skipped": [
    { "filename": "clip.mp4", "reason": "video_not_allowed" }
  ]
}
```

#### Errors
- `400`: `{ "error": "At least one file is required" }`
- `403`, `413`, `503`.

---

### C. Excel Spreadsheet Upload (`POST /gated/upload/excel`)

Upload Excel files (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`). Max size limit: 512 MB.

#### Headers & Body
- Header: `X-Upload-Ticket: <ticket>`
- Body: `multipart/form-data` with `file` part.

#### Response Shapes (`201 Created`)
```json
{
  "key": "product/uuid.xlsx",
  "filename": "uuid.xlsx",
  "originalName": "report.xlsx",
  "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

#### Errors
- `400`: `{ "error": "Only Excel files are allowed (.xlsx, .xls, .xlsm, .xlsb)" }`
- `403`, `413`, `503`.

---

### D. Chat File Attachment (`POST /gated/chat/upload_file`)

Upload a single chat attachment (stored under `originals/chat/`). Max size limit: 25 MB.

#### Headers & Body
- Header: `X-Upload-Ticket: <ticket>`
- Body: `multipart/form-data` with `file` part.

#### Response Shapes (`201 Created`)
```json
{
  "isSuccessful": true,
  "hasContent": true,
  "code": 200,
  "message": null,
  "detailed_error": null,
  "data": {
    "file_path": "https://media_server.ramaaz.dev/chat/file/uuid.pdf",
    "key": "originals/chat/uuid.pdf",
    "filename": "uuid.pdf",
    "originalName": "document.pdf",
    "contentType": "application/pdf",
    "size": 123456,
    "type": "file"
  }
}
```

#### Errors
- `400`: `{ "message": "File is required", "error": "File is required", "code": 400, "isSuccessful": false }`
- `413`: `{ "message": "File exceeds the size limit", "error": "File exceeds the size limit", "code": 413, "isSuccessful": false }`
- `403`: `{ "error": "Forbidden" }`
- `503`: `{ "error": "Service unavailable" }`

---

## 3. Supported File Types & Key Constraints

### Byte-Based Type Detection
- File type and stored extension are derived **strictly from leading bytes (magic numbers)**. Client filenames and `Content-Type` headers are ignored.
- **Unrecognized types are never rejected**; they store as `.bin` (`application/octet-stream`) and download safely.

### Type & Delivery Behavior
- **Inline Browser Rendering**: `JPEG`, `PNG`, `GIF`, `WEBP`, `AVIF` (images), `MP4`, `MOV`, `WEBM` (video), `MP3`, `M4A`, `WAV`, `FLAC`, `OGG` (audio).
- **Forced Downloads (Attachment)**: `SVG` (prevents XSS), `PDF`, Excel (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`), and all unrecognized/binary files.

### Key Constraints Checklist
- **Ticket TTL**: 120 seconds. Mint immediately before upload.
- **Single-Use**: Failed or interrupted uploads consume the ticket. Every retry requires minting a new ticket.
- **Folder Validation**: `/`-separated `[A-Za-z0-9._-]`. No leading/trailing `/`, `.`/`..` path traversal, backslashes, or NUL bytes.
- **Bulk Route**: Images only (videos skipped/reported). Max 50 files per ticket.
- **Excel Route**: Extension must match byte container (`zip` for `.xlsx`/`.xlsm`/`.xlsb`, `ole2` for `.xls`).

---

## Quick Reference Summary

| Route | Auth Header | Body / Content-Type | Size / Notes |
|---|---|---|---|
| `POST /gated/ticket` | `Authorization: Bearer <token>` | `application/json` | Mints single-use ticket (TTL: 120s) |
| `POST /gated/upload` | `X-Upload-Ticket: <ticket>` | `multipart/form-data` (`file`) | Max 100 MB (10 MB story) |
| `POST /gated/upload/bulk` | `X-Upload-Ticket: <ticket>` | `multipart/form-data` (`file` x count) | Images only |
| `POST /gated/upload/excel` | `X-Upload-Ticket: <ticket>` | `multipart/form-data` (`file`) | Max 512 MB (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`) |
| `POST /gated/chat/upload_file` | `X-Upload-Ticket: <ticket>` | `multipart/form-data` (`file`) | Max 25 MB (lands in `chat/`) |
