# Project Knowledge Base: PicHost

## 1. Executive Summary

- **Core Purpose**: A free, serverless image hosting service that uses the Telegram Bot API as an infinite object store behind a Cloudflare Workers proxy, eliminating cloud storage costs entirely.
- **Target Audience/Users**: Developers, privacy-conscious users, and hobbyists who want a personal, self-hosted image host with zero storage bills and minimal infrastructure overhead.
- **Primary Tech Stack**: JavaScript (ES2022+), Cloudflare Workers (Service Worker runtime), Cloudflare KV (key-value storage), Telegram Bot API (file persistence/CDN), Google Identity Services OAuth 2.0.

## 2. System Architecture & Component Mapping

### High-Level Design

The system follows a **zero-storage proxy architecture**:

```
Browser (index.html)
    │
    │ HTTPS (session cookie auth)
    ▼
Cloudflare Worker (worker.js)  ←── Cloudflare KV (img:*, user:*)
    │
    │ HTTP (Bot API)
    ▼
Telegram Servers  ─── Telegram CDN ─── File Storage
```

1. The **single-page frontend** (`index.html`) communicates exclusively with the Cloudflare Worker via REST API endpoints.
2. The **Worker** handles authentication (session cookies), proxies uploads to Telegram, stores metadata pointers in KV, and streams images back through the Cloudflare edge network.
3. **Telegram** acts as the blob store — files are uploaded as photos to a private Telegram channel via the Bot API.
4. **Cloudflare KV** stores only tiny metadata objects (file_id, owner, message_id, timestamp) — never the image bytes themselves.

### Directory Structure

```
PicHost/
├── index.html               # Single-file SPA frontend (auth, gallery, upload, settings)
├── README.md                 # Full documentation with setup guide & architecture diagram
├── LICENSE                   # MIT License
├── KNOWLEDGE.md              # THIS FILE — project knowledge base
│
└── backend/
    ├── worker.js             # Cloudflare Workers runtime — all API routes & Telegram proxy logic
    ├── package.json          # Empty package (deployment marker, no deps)
    └── wrangler.toml         # Wrangler configuration: bindings, vars, KV namespace
```

### Key Modules

- **`index.html`**: Monolithic single-page application (~800 lines). Contains all HTML, CSS (custom property theme engine with 4 accent colors), and JavaScript. Handles Google OAuth rendering, username/password auth forms, drag-drop/paste upload, responsive image gallery with lazy loading, settings panel, toast notifications, and progress indicators. No build tools or npm dependencies — served as a static file.

- **`backend/worker.js`**: Cloudflare Workers ES module (~350 lines). Defines 10 REST endpoints under a single `fetch()` handler. Responsible for session cookie management (HttpOnly, Secure, SameSite=None), password hashing (SHA-256 via Web Crypto API), Telegram Bot API communication, KV CRUD operations, and edge-cached image streaming.

- **`backend/wrangler.toml`**: Wrangler v3 configuration. Declares the KV namespace binding (`IMG_KV`), two required environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), and compatibility date `2026-03-10`.

## 3. Data Model & State Management

### Databases/Storage

| Storage | Purpose | Data |
|---------|---------|------|
| **Cloudflare KV** | Primary database — key-value store for all persistent data | User profiles (`user:*`), image metadata (`img:*`) |
| **Telegram CDN** | Blob/object store — raw image bytes | Actual image files in a private Telegram channel |
| **LocalStorage** (browser) | Client-side preferences | `worker_url`, `theme`, `theme_color` |

### Core Entities/Schemas

**Image Metadata (`img:{8-char-id}`)**
```json
{
  "file_id": "AgAC...",        // Telegram file_id (pop() = highest resolution)
  "message_id": 1234,          // Telegram message ID (for deletion)
  "owner": "alice",            // Username who uploaded (session user)
  "uploaded": 1712345678901    // Unix timestamp in ms
}
```

**User Profile (`user:{username}`)** — Standard account:
```json
{
  "password": "5e8848...ae08", // SHA-256 hex digest
  "created": 1712345678901
}
```

**User Profile (`user:{username}`)** — Google-linked account:
```json
{
  "google": true,
  "email": "user@gmail.com",
  "picture": "https://...",
  "name": "User Name",
  "created": 1712345678901
}
```

**Internal Google Username**: Derived as `google_{sub}` where `sub` is the Google account's unique subject identifier.

**Frontend State (`window.STATE`)**
```js
{
  worker: "https://...",   // Worker URL from localStorage or default
  images: [                // Array of { id, raw: "/raw/xxx", timestamp }
    { id: "abc12345", raw: "/raw/abc12345", timestamp: 1712345678901 }
  ],
  user: {                  // User profile from /me endpoint
    username: "alice",
    name: "Alice",
    email: "Standard Account",
    picture: null,
    isGoogle: false
  }
}
```

### State Flow

1. **Bootstrap**: On page load, `checkSession()` fires. It `Promise.all`s `GET /list` and `GET /me`. If both succeed → user is authenticated → dashboard renders with gallery + profile menu. If either fails → auth page is shown.
2. **Auth Transition**: Login/register/Google login sets a session cookie (HttpOnly, Secure, SameSite=None) via `Set-Cookie` response header. The frontend then `location.reload()`s or re-calls `checkSession()`.
3. **Upload Flow**: XHR upload with progress tracking → Worker stores metadata in KV → `checkSession()` re-fetches list → gallery re-renders.
4. **Image Viewing**: `GET /raw/{id}` → Worker reads KV → calls Telegram `getFile` → gets temp download URL → streams bytes through Cloudflare with `Cache-Control: public, max-age=86400`.
5. **Delete Flow**: `GET /delete/{id}` → Worker verifies `owner === sessionUser` → calls Telegram `deleteMessage` → deletes KV key → frontend re-fetches list.

## 4. Operational Runbook

### Prerequisites

- Node.js 18+ (for Wrangler CLI)
- Cloudflare account (free tier — Workers + KV)
- Telegram account (for BotFather and channel creation)
- A static file server for `index.html` (VS Code Live Server, `npx serve`, Cloudflare Pages, etc.)

### Setup & Installation

**Telegram Bot & Channel:**
```bash
# 1. Create bot via BotFather on Telegram
#    /newbot → copy Bot Token

# 2. Create private Telegram channel
# 3. Add bot as Administrator (posting + deletion permissions)
# 4. Get Chat ID (forward message to @userinfobot)
```

**Backend Deployment (Cloudflare Workers):**
```bash
cd backend

# Install Wrangler (if not installed)
npm install -g wrangler

# Deploy (interactive — enter secrets when prompted)
wrangler deploy

# Or set secrets separately:
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

The KV namespace `IMG_KV` must be created in the Cloudflare Dashboard and bound in `wrangler.toml`.

### Local Development

```bash
# Serve frontend locally (cookies require http://, not file://)
npx serve .
# → Opens at http://localhost:3000

# Run Worker locally with Wrangler dev server
cd backend
wrangler dev --remote   # Uses remote KV + secrets
```

### Testing

No test suite exists. Manual verification paths:
- Open frontend → pre-settings modal asks for Worker URL
- Create account → upload image → verify gallery renders
- Delete image → verify KV key removed and Telegram message deleted
- Check browser DevTools Network tab for CORS and auth headers
- Verify `Cache-Control: public, max-age=86400` on `/raw/` responses

## 5. Critical Workflows & Business Logic

### Step-by-Step Execution

**Upload Journey (full trace):**
1. User drags image to dropzone or pastes from clipboard → `window.handleFiles(files)` is called
2. `uploadFile(file)` creates an XHR with `POST /upload` (credentials: include)
3. `worker.js` → `uploadImage()` handler:
   - Reads `session={user}` from Cookie header → `getSessionUser(request)`
   - Validates file exists in `FormData`
   - Constructs `FormData` with `chat_id` from `env.TELEGRAM_CHAT_ID` and the photo
   - Calls `POST https://api.telegram.org/bot{TOKEN}/sendPhoto`
   - On success, takes `tgData.result.photo.pop().file_id` (highest resolution)
   - Generates 8-char random ID via `crypto.randomUUID().slice(0, 8)`
   - Writes `{ file_id, message_id, owner, uploaded }` to KV at `img:{id}`
   - Returns `{ id, raw: "/raw/{id}" }` as JSON
4. XHR `onload` → `checkSession()` re-fetches `/list` → gallery re-renders with new image

**Image Viewing Journey (full trace):**
1. Browser requests `GET /raw/abc12345` → `worker.js` → `rawImage(id, env)`
2. Reads `img:abc12345` from KV → gets `meta.file_id`
3. Calls `GET https://api.telegram.org/bot{TOKEN}/getFile?file_id={file_id}` → gets `file_path`
4. Constructs `https://api.telegram.org/file/bot{TOKEN}/{file_path}`
5. Fetches that URL, streams the response body back to the client
6. Response headers: `Content-Type: image/jpeg` + `Cache-Control: public, max-age=86400`
7. Frontend `<img>` tag with `loading="lazy"` shows skeleton loader until `onload` fires

**Google Login Flow:**
1. Google Identity Services renders the "Sign in with Google" button in `#google-login-container`
2. User authenticates → Google calls `window.handleGoogleLogin(response)` with credential token
3. Frontend sends `POST /google-login` with `{ token: response.credential }`
4. Worker fetches `https://oauth2.googleapis.com/tokeninfo?id_token={token}` to verify
5. Extracts `sub, email, picture, name` from verified token data
6. Creates internal username `google_{sub}` and stores user profile in KV at `user:google_{sub}`
7. Issues standard session cookie: `Set-Cookie: session=google_{sub}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=None`
8. Returns user profile JSON → frontend calls `checkSession()`

### Edge Cases & Error Handling

| Scenario | Where | Behavior |
|----------|-------|----------|
| **File > 20 MB** | Telegram Bot API | `sendPhoto` fails — Worker returns `Telegram Error: ...` with 500 status. Frontend shows "Upload failed" toast. |
| **KV list limit** | `listImages()` | `IMG_KV.list()` capped at 1000 keys. No pagination implemented — users with >1000 images will see only the most recent 1000. |
| **Google token expired/invalid** | `googleLogin()` | Google's tokeninfo endpoint returns non-200. Worker returns 401 "Invalid Google Token". |
| **Mixed auth (Google user tries password login)** | `login()` | Worker detects `user.google === true`, returns 400 "Please sign in with Google". |
| **Corrupted KV data** | `login()`, `listImages()` | Try-catch around `JSON.parse()` — corrupted entries are silently skipped in listing, or return 500 on login. |
| **Telegram file deleted/expired** | `rawImage()`, `downloadImage()` | `getFile` returns `!ok` → Worker throws "File not found on Telegram" → 500 response. |
| **User deletes another user's image** | `deleteImage()` | Worker checks `meta.owner !== user` → returns 403 Forbidden. |
| **Missing/expired session** | All auth-gated routes | `getSessionUser()` returns `null` → 401 Unauthorized. Frontend falls back to auth page. |
| **Network failure to Telegram** | `uploadImage()`, `rawImage()` | `fetch()` throws → caught by generic try-catch → 500 error response. |
| **CORS preflight** | `OPTIONS` handler | Returns 204 with `Access-Control-Allow-Origin`, `-Methods`, `-Headers`, `-Credentials`. |
| **Dark mode preference** | Frontend bootstrap | Checks `localStorage.getItem('theme')`, falls back to `matchMedia('(prefers-color-scheme: dark)')`. |

## 6. Extension & Contribution Guide

### Adding New Features

**To add a new API route:**
1. Add the route in `backend/worker.js` within the `fetch()` method's if-else chain (lines `path === "/..." && method === "..."`)
2. Implement the handler function below the existing handlers following the pattern:
   - Get session user via `getSessionUser(request)` for auth-gated routes
   - Use `env.IMG_KV` for KV operations
   - Return a `new Response(body, { headers })` with appropriate status code
3. Add UI in `index.html` — place HTML in the appropriate page section (`#auth-page` or `#dashboard-page`), add event handlers, and wire up to the new endpoint
4. CORS headers are injected automatically by the response wrapper at the bottom of `fetch()`

**To add a new authentication provider:**
1. Add a `/provider-login` route in `worker.js`
2. Verify the provider's token server-side (similar to Google's `tokeninfo` pattern)
3. Store user with a prefixed internal username (e.g., `github_{id}`)
4. Add the OAuth button in `index.html`'s `#form-login` section

**To add image transformations:**
1. Add a new route like `/transform/{id}?w=200&h=200` in `worker.js`
2. Fetch the image from Telegram as in `rawImage()`, then apply transforms
3. Use Cloudflare's built-in image resizing if enabled on the account, or proxy to a transformation service

### Coding Standards

- **Frontend (`index.html`)**: All JavaScript is vanilla ES2022 — no TypeScript, no bundlers, no frameworks. Event handlers are attached via `onclick`/`onchange` attributes. State is stored in `window.STATE`. UI rendering uses template literals with `.innerHTML` assignment. Icons use the Lucide library loaded from CDN.
- **Backend (`worker.js`)**: ES module format (`export default { async fetch(request, env) { ... } }`). No external dependencies — only Web APIs (`crypto.subtle`, `fetch`, `FormData`, `URL`). Session management is cookie-based (manual parsing, no libraries). Error handling uses try-catch with generic 500 fallback. All KV keys follow `entity:identifier` prefix convention (`img:`, `user:`).
- **No TypeScript**: The entire codebase is plain JavaScript without type annotations.
- **No testing framework**: No unit, integration, or E2E tests. Validation is done manually.
- **Deployment**: Backend deploys via `wrangler deploy` — no CI/CD pipeline configured.
- **Environment variables**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are Worker secrets, set via `wrangler secret put` or Cloudflare Dashboard.
