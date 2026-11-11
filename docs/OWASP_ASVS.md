# OWASP ASVS / Top 10 checklist

This is a mapping, not a certification. Status means implemented/tested in this repository unless
marked manual or pending.

| Area                   | Status              | Main evidence                                                               |
| ---------------------- | ------------------- | --------------------------------------------------------------------------- |
| V1 Architecture        | Implemented         | trust boundaries and threat model in `SECURITY.md`                          |
| V2 Authentication      | Implemented         | password KDF, HIBP, generic errors, TOTP, lockout, session list             |
| V3 Session management  | Implemented         | Secure/HttpOnly/SameSite, short JWT, hashed rotating refresh, replay revoke |
| V4 Access control      | Implemented/tested  | resource membership + permission service, IDOR integration tests            |
| V5 Validation/encoding | Implemented/tested  | Valibot, bounds, Svelte escaping, parameterized D1, upload inspection       |
| V6 Cryptography        | Implemented         | Web Crypto PBKDF2/HMAC/AES-GCM; secrets separated; no custom E2EE claim     |
| V7 Errors/logging      | Implemented         | generic centralized errors; request IDs; PII/secret exclusion               |
| V8 Data protection     | Partial             | export/delete, no trackers, private media; E2EE pending                     |
| V9 Communications      | Implemented         | HTTPS/HSTS/WSS, origin checks, Android cleartext off                        |
| V10 Malicious code     | Implemented/partial | lockfile/audit/gitleaks; external malware scan optional                     |
| V11 Business logic     | Implemented/tested  | invite bounds, age gate, slow mode, automod, permission escalation checks   |
| V12 Files/resources    | Implemented/tested  | size/MIME/magic/metadata/random key/content disposition                     |
| V13 API/WebSocket      | Implemented/tested  | auth per request/event, caps, rate/backpressure, OpenAPI                    |
| V14 Configuration      | Implemented/manual  | CSP/CORS/env secrets/pinned Actions; deployment review required             |

## OWASP Top 10 (2021) summary

1. **Broken access control:** deny-by-default membership and bitmask checks; tested outsider/member.
2. **Cryptographic failures:** TLS, strong random material, PBKDF2, AES-GCM, no plaintext tokens.
3. **Injection:** schema validation, prepared statements, no shell/user path execution.
4. **Insecure design:** threat model, limits, moderation, replay design, explicit residual risks.
5. **Security misconfiguration:** strict headers, minimal native capabilities, no release debug.
6. **Vulnerable components:** exact lockfile, audit/OSV/Dependabot workflows.
7. **Identification failures:** lockout/rate limits, HIBP, TOTP, refresh reuse detection.
8. **Integrity failures:** signed native releases/updater workflow, pinned CI actions, secret scan.
9. **Logging failures:** request IDs and minimal structured error events; provider alerts required.
10. **SSRF:** feature omitted; requirements documented before adding remote previews.
