# Security design and threat model

Security contact: replace `security@example.com` before a public launch. Do not report a suspected
vulnerability in a public issue until the operator confirms a disclosure path.

## Assets and trust boundaries

**Assets:** credentials, sessions, private messages/files, moderation authority, account identity,
community roles, and availability/free-tier quota.

**Untrusted inputs:** every browser/WebView value, URL parameter, JSON/WebSocket frame, upload,
Origin, OAuth/email callback, filename, and ID. The Worker, D1 and object-storage bindings, and configured secrets
form the server trust boundary. Community moderators are privileged only inside their server.

**Primary threats:** credential stuffing, refresh-token theft/replay, CSRF, XSS, IDOR/BOLA,
permission escalation, SQL injection, malicious uploads, spam/invite abuse, WebSocket floods,
private-media disclosure, supply-chain compromise, log leakage, and denial of wallet.

## Implemented controls

### Authentication and sessions

- Passwords: PBKDF2-HMAC-SHA-256, random 128-bit salt, 100,000 iterations, constant-time compare.
  Web Crypto is used because Workers does not provide native Argon2id. HIBP range API checks only
  the first five SHA-1 hex characters and requests padded results. 100,000 iterations is the
  platform ceiling: Cloudflare Workers rejects higher PBKDF2 iteration counts with
  `NotSupportedError`, so a larger value is not usable in production.
- 12–128 characters with upper/lowercase and a number; generic registration/login/reset behavior,
  IP + account rate limits, exponential account lockout.
- HS256 access JWT: explicit algorithm, `iss=nexa`, token type, session ID, JTI, issued/expiry checks,
  and 15-minute lifetime. A high-entropy 32+ byte secret is mandatory.
- 30-day opaque refresh tokens are SHA-256 hashed. Rotation stores one previous hash; replay of it
  revokes every active session. Refresh updates use a compare-and-swap condition to detect races.
- Web tokens use Secure, HttpOnly (access/refresh), SameSite=Strict cookies. CSRF is a double-submit
  random value whose hash is bound to the D1 session. Native WebViews use OS-managed cookie jars.
- AES-GCM encrypts TOTP secrets with a separate 256-bit key. TOTP accepts only the current ±30 s
  window. Users can inspect/revoke sessions or log out everywhere.

### Authorization

- Every route derives the user from a valid server session. Channel and conversation access is
  queried server-side; media access repeats those relationships.
- Roles use integer bitmasks. The order is base roles → everyone overwrite → combined role
  overwrites → member overwrite. Granting permissions the actor does not possess is blocked.
- Community ownership, moderator permissions, channel visibility, mute, announcement, slow-mode,
  and automod decisions never trust client-calculated permissions.
- Tests cover owner/member/outsider cases, role/member overwrites, missing resources, and a real
  forbidden channel-creation attempt by a normal member.

### Input, output, and files

- Valibot schemas bound strings, arrays, MIME choices, integer ranges, IDs, and body sizes.
- Svelte escapes rendered text; no user value reaches `innerHTML`. Markdown is not enabled, avoiding
  a sanitizer bypass class. Strict CSP disallows remote script and object execution.
- D1 uses `prepare().bind()` only. Search wildcard characters are escaped. No dynamic identifier is
  derived from user text; the two message target columns are selected from a server enum.
- No server-side arbitrary URL fetch/link preview exists, removing the MVP SSRF surface. If added,
  require DNS/IP revalidation, private-range blocking, redirects off, timeout, and response caps.
- Uploads have byte caps, an allowlist, magic-byte inspection, random keys, safe display filenames,
  JPEG APP1/APP13/APP14/comment stripping, PNG ancillary metadata stripping, and WebP EXIF/XMP
  stripping. SVG/HTML and executable formats are rejected. Non-media downloads use attachment
  disposition and every response has `nosniff` plus sandbox CSP.
- The browser re-encodes still images to WebP before upload, removing EXIF/GPS in normal use.
- Media lives in a private Backblaze B2 bucket. The Worker authenticates with AWS Signature V4 using a
  bucket-scoped application key held only as a Worker secret; the bucket never becomes public and
  object keys alone never grant access. Rotate the application key if it is ever exposed.

### Transport, realtime, and platform

- HTTPS/WSS only in production; HSTS, CSP, `nosniff`, Referrer/Permissions policies, frame denial,
  credentialed exact-origin CORS, and WebSocket Origin validation.
- WebSocket frames max 16 KiB, have connection/event limits, session checks per event, room access
  checks, bounded send buffers, and 1013 backpressure close. Durable Object hibernation avoids idle
  execution and polling.
- Android: cleartext off, system trust anchors only, backup off, release debugging off, R8/resource
  shrinking, environment signing, and no unnecessary camera/location/storage permissions.
- Tauri: local static assets only, strict CSP, one window, and capabilities limited to core,
  deep-link, and signed updater. No shell, filesystem, process, or arbitrary Tauri HTTP permission.

### Privacy and operations

- No analytics/advertising SDK. Recent offline API content is opt-in, origin-local, and cleared on
  logout. Logs exclude bodies, cookies, authorization headers, and user data.
- Export and hard deletion are implemented. Upload objects are removed before relational cascade.
- `.env*`, keys, keystores, and generated secrets are ignored. CI runs audit and secret scanning.

## Known residual risks

| Risk                           | Current position / next control                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No DM E2EE                     | TLS + server authorization only. Use an audited multi-device Signal-style protocol; do not invent one.                                                         |
| Browser Web Push sender        | Subscriptions exist, but VAPID payload encryption sender is not complete. In-app + Android FCM work.                                                           |
| Malware inside allowed ZIP/PDF | Forced download and sandbox headers reduce execution. Add ClamAV on a self-hosted async quarantine path if required.                                           |
| Public STUN cannot relay       | Configure Cloudflare Realtime TURN and enforce its usage budget.                                                                                               |
| PBKDF2 CPU/free Worker limit   | Benchmark deployment. If 310k exceeds the 10 ms free CPU budget, move password derivation to a tiny trusted auth service with Argon2id; do not lower silently. |
| Community role hierarchy       | Permission escalation is blocked by bit subset; add strict role-position hierarchy before large multi-admin deployments.                                       |
| Legal/admin workflows          | Templates and queue exist; operators need real contacts, retention policy, appeal process, and staffed response.                                               |

## Secret rotation

1. Rotate `JWT_SECRET`: deploy code that accepts old + new for at most 15 minutes, signs only new,
   then remove old. Current single-key implementation instead requires logging everyone out.
2. Rotating `DATA_ENCRYPTION_KEY` requires decrypt/re-encrypt of TOTP secrets. Disable affected TOTP
   if the old key is lost.
3. Rotate Resend/Cloudflare/Firebase keys in provider dashboards, then `wrangler secret put`.
4. Revoke Android/Tauri signing keys only through their documented compromise process; preserve
   signing keys in an offline encrypted backup.

See [PENTEST_REPORT.md](PENTEST_REPORT.md) and [OWASP_ASVS.md](OWASP_ASVS.md).
