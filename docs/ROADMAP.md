# Roadmap

## Before a public production launch

- Complete standards-compliant Web Push VAPID payload delivery and expiry cleanup.
- Run/publish every pending item in `TEST_REPORT.md`, including native memory and one-hour leak data.
- Independent security review, full endpoint IDOR matrix, and staging ZAP baseline.
- Finish operator legal contacts, moderation appeals, retention schedule, and abuse staffing.
- Add recovery codes and reauthentication for especially sensitive account changes.
- Enforce role-position hierarchy in addition to permission-subset checks.

## Later

- Audited multi-device E2EE for DMs and small groups (identity verification, prekeys, double ratchet,
  sender keys, backup/recovery)—never a home-grown cipher.
- Cloudflare TURN/SFU fallback, then optional video/screen share with explicit bandwidth controls.
- Bots/plugins with isolated scopes, reviewable manifests, server-side quotas, and no remote code in
  clients.
- Public community discovery ranking, richer notification preferences, scheduled announcements,
  moderation rules, and appeal workflows.
- Federated/decentralized research only after abuse, identity, and key-distribution implications are
  understood.
