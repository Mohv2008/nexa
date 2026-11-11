# Test and performance report

Run date: **2026-11-12** · Host: Windows, Node 24.20.0 · source tree in this repository.

Only commands actually run are marked passed. Missing toolchains/hardware are not reported as
passing or replaced with invented numbers.

## Recorded results

| Gate                                   | Result                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Shared unit tests                      | **9/9 passed**, 3 files                                                |
| Worker unit/integration/security tests | **35/35 passed**, 9 files, real `workerd` + isolated D1/R2/DO bindings |
| Backend coverage                       | **81.21% statements, 83.50% lines, 87.87% functions, 76.43% branches** |
| Shared coverage                        | **86.11% statements, 89.06% lines, 85.71% functions, 72.41% branches** |
| Svelte strict diagnostics              | **0 errors, 0 warnings**                                               |
| Backend TypeScript strict diagnostics  | **passed**                                                             |
| Android wrapper TypeScript/config      | **passed**                                                             |
| Tauri JSON config check                | **passed**                                                             |
| D1 migrations                          | **64 statements/commands applied successfully across two migrations**  |
| Worker dry-run bundle                  | **58.85 KiB gzip**                                                     |
| PWA production build + service worker  | **passed**                                                             |
| First-route JavaScript budget          | **66.5 KiB gzip**, limit 150 KiB                                       |
| Lighthouse CI (3 desktop runs)         | **92 median Performance, 100 Accessibility, 100 Best Practices/SEO**   |
| Playwright E2E                         | **12 passed, 4 intentionally skipped by project applicability**        |
| Desktop browser workflow               | **passed on Chromium, Firefox, and WebKit**                            |
| Mobile viewport + axe                  | **Pixel 7 passed; landing/auth WCAG A/AA scans had 0 violations**      |
| `npm audit`                            | 0 high, 0 critical; **4 low** transitive advisories reported           |
| Rust dependency lock                   | **516 packages resolved in committed `Cargo.lock`**                    |
| `cargo check --locked`                 | reached compilation; **blocked by absent MSVC `link.exe`**             |

The backend coverage gate requires ≥80% statements/lines/functions and ≥75% branches. Shared core
requires ≥80% statements/lines/functions and ≥70% branches. Branch percentages are shown rather
than hidden; improve them toward 80% as adapters gain test fixtures.

## What the integration tests cover

- health/security headers; unauthorized, malformed JSON, unsupported media type, and evil Origin;
- real registration/session cookies/CSRF; account retrieval;
- community create/public join; normal member denied channel management;
- post/create/like/feed/report; channel send/history;
- owner/member/outsider permissions and all overwrite stages;
- DM idempotency, reply validation, attachment ownership, slow mode, mute, link/word automod,
  announcement authorization, and invalid voice-message attempts;
- JWT tamper/expiry, PBKDF2, AES-GCM, TOTP; upload spoof rejection/metadata removal;
- notification self-suppression/mention resolution; HTTP and schema boundary helpers.
- browser register → community create → channel message → post → logout across three desktop
  engines; mobile registration layout and automated axe A/AA scan.
- animated landing/download page CTAs, local video/poster assets, mobile navigation, and downloads
  section on Chromium, Firefox, WebKit, and Pixel 7 emulation.
- Durable Object internal auth, WebSocket ready/heartbeat, ordered message creation, nonce
  deduplication, and oversized-frame close behavior.

## Defined but not run on this machine

| Test                                  | Reason / command                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| k6 500 WebSockets                     | avoid accidental provider load; set dedicated `WS_URL` and run `k6 run tests/load/realtime.js` |
| OWASP ZAP baseline                    | requires deployed staging URL; CI manual security workflow                                     |
| APK compile/sign/install              | Java/Android SDK absent locally; native release CI                                             |
| Windows EXE/MSI compile/install       | Rust compiled dependencies until absent MSVC linker; native release CI                         |
| Android 8–latest emulator/device      | requires SDK emulators and at least one real low-end device                                    |
| Windows 10/11 idle RAM/CPU            | requires built signed artifacts on both OS versions                                            |
| Browser/Android/Windows one-hour leak | requires each runtime and profiler                                                             |
| Voice across restrictive NAT/TURN     | needs two networks and optional TURN configuration                                             |
| Push delivery                         | needs real VAPID/Firebase credentials and devices                                              |
| Backup/restore remote D1/R2           | local migration proven; remote account not provided                                            |

## Required measurement procedure

1. Build release mode, seed 10 communities/1,000 messages, restart the app, then leave it idle for
   five minutes. Record private working set and 60-second average CPU. Do not compare debug builds.
2. Repeat after one hour of switching feeds/channels and joining/leaving voice; memory should return
   near baseline after GC/idle. Capture heap snapshots if it grows monotonically.
3. Run Lighthouse on a clean Chrome profile, throttled mobile preset, three times; report median and
   attach JSON. Target >90 performance/accessibility/best-practices/PWA where Lighthouse exposes it.
4. Use Android low-end emulation (2 cores, 2 GB), API 26 and latest API, plus one physical device.
5. Archive raw artifacts under the release, update this report, and never substitute targets for
   observations.
