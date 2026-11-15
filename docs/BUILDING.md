# Beginner setup, deployment, and native builds

## 1. Install local tools

1. Install Git and Node.js 22.12 or newer.
2. Clone the repository and run `npm install` at its root.
3. Copy `backend/.dev.vars.example` to `backend/.dev.vars`.
4. Generate independent random values. Examples:
   - OpenSSL: `openssl rand -base64 32`
   - PowerShell: `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))`
5. Set `HIBP_ENABLED=false` only for isolated tests; normal registration should check HIBP.
6. Run the two migrations and servers shown in the root README.

Do not use example secrets, commit `.dev.vars`, or expose Wrangler on a public interface.

## 2. Create Cloudflare resources (free plan)

1. Create a Cloudflare account. Review current limits in `FREE_TIER.md` first.
2. Install/authenticate Wrangler: `npx wrangler login`.
3. Create D1: `npx wrangler d1 create nexa-db`. Put its returned UUID in
   `backend/wrangler.toml` instead of the all-zero placeholder.
4. Create the media bucket (see section 2a) and apply remote migrations:
   `npm run db:migrate:remote --workspace=@nexa/backend`.
5. Store secrets (repeat per name):

   ```bash
   cd backend
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put DATA_ENCRYPTION_KEY
   npx wrangler secret put INTERNAL_SECRET
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put FIREBASE_PRIVATE_KEY
   npx wrangler secret put B2_ENDPOINT
   npx wrangler secret put B2_REGION
   npx wrangler secret put B2_BUCKET
   npx wrangler secret put B2_ACCESS_KEY_ID
   npx wrangler secret put B2_SECRET_ACCESS_KEY
   ```

6. Change `ALLOWED_ORIGINS` and `WEB_URL` in `wrangler.toml` to real HTTPS origins. Change the CSP
   API placeholder in `apps/web/vite.config.ts`, `static/_headers`, and the Tauri config.
7. Deploy API: `npm run deploy --workspace=@nexa/backend`. Verify `/health` reports `"media":"b2"`.

## 2a. Media storage: Backblaze B2 (free, no card)

NEXA stores uploads in [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing) through its
S3-compatible API. The first 10 GB is free indefinitely and signing up does not require a credit
card, which keeps the whole stack on free tiers. Cloudflare R2 remains supported as an alternative
backend (see `backend/wrangler.toml`).

1. Create a Backblaze account and enable B2 Cloud Storage. Choose the region carefully; it cannot be
   changed later.
2. Create a **private** bucket, for example `nexa-media`. Keep it private: NEXA authorizes reads
   itself through `/v1/media/*`.
3. Create an **application key** limited to that bucket with _Read & Write_ and _Delete_ permissions.
   Copy the `keyID` and `applicationKey` — the application key is shown only once.
4. Copy the bucket **Endpoint** from the bucket details page and strip the bucket path, leaving the
   origin only, for example `https://s3.us-west-004.backblazeb2.com`. The region identifier is the
   middle segment (`us-west-004`).
5. Set the five `B2_*` Worker secrets listed above. `B2_ENDPOINT`/`B2_REGION`/`B2_BUCKET` are not
   sensitive but are stored as secrets so a single mechanism covers every value.
6. The deploy pipeline expects the same five values as GitHub Actions secrets
   (`B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY`).
7. Rotate the application key if it is ever exposed; a key limited to one bucket can still delete
   every object in it.

## 3. Deploy the PWA to Pages

1. Create a Pages project connected to the GitHub repository, or use the pinned deploy workflow.
2. Build command: `npm ci && npm run build --workspace=@nexa/web`.
3. Output directory: `apps/web/build`.
4. Set `PUBLIC_API_URL=https://your-api.example/v1`, `PUBLIC_WEB_URL`, optional
   `PUBLIC_VAPID_PUBLIC_KEY`, and the three release links (`PUBLIC_RELEASE_URL`,
   `PUBLIC_WINDOWS_DOWNLOAD_URL`, `PUBLIC_ANDROID_DOWNLOAD_URL`) at build time.
5. Attach a domain and verify `_headers` in DevTools. The PWA must be HTTPS to install.

Prefer `app.example.com` + `api.example.com`: they are separate origins but same site, which works
with strict cookies. Never use `Access-Control-Allow-Origin: *` with credentials.

Set Capacitor's `server.hostname` to that same app host before release. Tauri's fixed local origin is
explicitly allowlisted and receives `SameSite=None; Secure` HttpOnly cookies; all other browser
origins receive `SameSite=Strict`. Native tokens remain outside JavaScript storage in the OS WebView
cookie jar.

## 4. Email

Resend's checked 2026 free tier is 3,000 transactional messages/month and 100/day. Create and verify
a sending domain, make a restricted API key, set `RESEND_API_KEY`, and set `EMAIL_FROM`. If no key is
configured, registration still works but delivery is intentionally skipped. Never expose the key to
the frontend.

## 5. Firebase Android push

1. Create a free Firebase project and Android app with package `app.nexa.community`.
2. Download `google-services.json` to `apps/android/android/app/`; it is gitignored/secret material.
3. Create a service account restricted to Firebase Messaging. Store project ID, client email, and
   PKCS#8 private key as Worker secrets. The private key can contain escaped `\\n` newlines.
4. FCM is free, but Firebase quotas/policies can change. Re-check before launch.

## 6. Android APK

Install Android Studio, Java 21, Android SDK 36, and accept SDK licenses. Then:

```bash
npm run sync --workspace=@nexa/android
cd apps/android/android
./gradlew assembleDebug
```

Create an upload key once and keep an encrypted offline backup:

```bash
keytool -genkeypair -v -keystore nexa-release.jks -alias nexa -keyalg RSA -keysize 4096 -validity 10000
```

Set `NEXA_KEYSTORE_PATH`, `NEXA_KEYSTORE_PASSWORD`, `NEXA_KEY_ALIAS`, `NEXA_KEY_PASSWORD`, and
`NEXA_REQUIRE_SIGNING=true`, then run `./gradlew assembleRelease`. CI accepts the keystore as a
base64 GitHub secret and never commits it. Confirm with `apksigner verify --verbose` and inspect that
release is not debuggable, backup/cleartext are false, and R8 is enabled.

## 7. Windows installer

Install Rust **1.90+**, Microsoft C++ Build Tools, WebView2, and the Tauri Windows prerequisites.
Replace the updater endpoint and public key placeholder in `tauri.conf.json`, then:

```bash
npm run bundle --workspace=@nexa/desktop
```

Tauri produces NSIS `.exe`, MSI, and updater artifacts. Generate the updater key offline with Tauri,
store the private key in `TAURI_SIGNING_PRIVATE_KEY`, and publish only the public key. Authenticode
code signing normally requires a paid certificate; without it, expect SmartScreen warnings. A
self-signed certificate is useful for private managed devices but does not establish public trust.

## 8. GitHub repository and CI secrets

Public repositories receive standard GitHub-hosted runner usage free. Add:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Android keystore/password/alias secrets
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Optional Windows certificate secrets if your organization owns a trusted certificate

Use GitHub Environments for production approvals. Releases are immutable tags (`vX.Y.Z`). Review
Dependabot changes and never auto-merge native/crypto dependency upgrades without test artifacts.

## 9. Monitoring

Add `https://API/health` to UptimeRobot's free HTTPS monitor. Do not monitor an authenticated route.
Configure Cloudflare quota/budget alerts and Firebase delivery alerts. Free services provide no SLA.
