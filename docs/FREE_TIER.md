# Free-tier limits and scaling

Verified against official pages on **2026-11-11**. Limits change; follow the links before every
launch or scale event. “Free” means usage remains inside each provider allowance; none provides a
production SLA. NEXA cannot guarantee a permanently zero-cost third-party service.

## Checked limits

| Service                                                                                   | Current free allowance relevant to NEXA                                                                                       | What happens at the edge                                                                   |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Workers](https://developers.cloudflare.com/workers/platform/pricing/)                    | 100,000 requests/day; 10 ms CPU/invocation                                                                                    | requests over daily allowance fail; PBKDF2 must be benchmarked                             |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)    | SQLite DOs allowed; 100,000 requests/day; 13,000 GB-s/day; 5M rows read/day, 100k written/day, 5 GB SQL                       | over-limit operations fail until reset; incoming WS frames use a 20:1 billed-request ratio |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/)                              | 5M rows read/day, 100k rows written/day, 5 GB account storage, 10 DBs                                                         | D1 explicitly returns errors until 00:00 UTC; 500 MB max per free database per limits page |
| [R2](https://developers.cloudflare.com/r2/pricing/)                                       | 10 GB-month Standard, 1M Class A writes/month, 10M Class B reads/month, free egress                                           | metered service beyond allowance; use budget alerts and lifecycle cleanup                  |
| [Pages](https://developers.cloudflare.com/pages/platform/limits/)                         | 500 builds/month, one concurrent build, 20k files/site, 25 MiB/file, 100 custom domains                                       | builds/assets reject over limit; NEXA media is in R2                                       |
| [Realtime TURN/SFU](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)     | first 1,000 GB egress/month shared by TURN and SFU                                                                            | then $0.05/GB; optional, not enabled by default                                            |
| [GitHub Actions](https://docs.github.com/billing/concepts/product-billing/github-actions) | standard hosted runners free for public repos; private GitHub Free historically includes 2,000 min/month and 500 MB artifacts | private builds stop without billing when allowance/payment is absent                       |
| [Resend](https://resend.com/pricing)                                                      | 3,000 transactional emails/month, max 100/day, three domains                                                                  | sending stops; prioritize verify/reset mail                                                |
| Firebase Cloud Messaging                                                                  | no-cost messaging product; project/API safeguards still apply                                                                 | provider abuse controls can throttle                                                       |

Cloudflare's current R2 product page advertises “no credit card required,” but enrollment UI and
regional/account risk checks can change. Stop if a payment method is requested and that violates
your requirement; run NEXA without media uploads or use a provider you have independently verified.

## Capacity model (illustrative, not a promise)

### 100 registered users

- Likely fits when only a minority are simultaneously active.
- 10 GB R2 holds roughly 20,000 compressed 500 KB images, before voice/files.
- Email's 100/day cap is often the first launch-day constraint.
- P2P voice costs no relay quota when direct connections succeed.

**Free optimizations:** thumbnails and 1600 px cap, 20 MB hard files, expire unused uploads, bundle
notifications, hibernate sockets, keep indexed cursor queries, and sample logs.

### 1,000 registered users

Registration count is not the billing driver; daily activity is. At 10 API actions/user/day this is
~10k Worker requests plus WebSocket connects—still below 100k, but D1 row reads can multiply through
feeds/member lists. R2 reads can exceed its monthly operation allowance before storage does.

**Free steps:** cache public avatars/posts at the edge after authorization design review, denormalize
safe counters, paginate member lists, remove inactive media, send email only for security events,
and expose quota status. Avoid GitHub Actions keep-alive abuse.

### 10,000 registered users

A genuinely active community is unlikely to remain reliable on hard free limits. 1,000 daily active
users × 100 frames/actions can consume the Worker/DO request allowance; D1 feed scans and R2 reads
will fail first if not tightly indexed/cached. P2P mesh does not scale beyond six and client uplink
quality becomes the bottleneck.

**Honest options:** reduce nonessential realtime presence in low-power mode, shard hot rooms, use
TURN/SFU's included egress, archive media, and seek donations/sponsorship—or move to a paid plan.
Do not bypass provider limits with multiple accounts.

## Self-host fallback

The API boundaries allow a future Go/Rust service with PostgreSQL/SQLite-compatible persistence and
S3-compatible media. Oracle Cloud “Always Free” has historically required payment-card identity
verification, capacity can be unavailable, and its terms change; it is **not** a guaranteed no-card
fallback. Supabase free projects can have inactivity/size limits. Verify current terms and do not use
artificial keep-alive traffic that violates provider policies.

Switching requires implementing the same OpenAPI/WebSocket contract, exporting D1, copying R2, and
changing only `PUBLIC_API_URL`. Perform the restore test before DNS cutover.
