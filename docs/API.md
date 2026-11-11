# HTTP API

Base URL: `/v1`. Machine-readable OpenAPI 3.1 is served at `/v1/openapi.json` and defined in
`backend/src/openapi.ts`.

## Conventions

- Success body: `{ "data": ... }`; delete operations normally return `204`.
- Error body: `{ "error": { "code", "message", "details?", "requestId" } }`.
- Pagination: `?cursor=<opaque>&limit=30`; responses use `{ items, nextCursor }`.
- Web auth: `nexa_access`, `nexa_refresh`, and readable `nexa_csrf` Secure/SameSite cookies.
- Cookie mutations require `X-CSRF-Token`. Bearer-authenticated native requests do not.
- JSON bodies must send `Content-Type: application/json`. Uploads use `multipart/form-data`.

## Endpoint groups

| Group       | Principal routes                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | `POST /auth/register`, `/login`, `/refresh`, `/logout`; `GET/PATCH/DELETE /auth/me`; email verify/reset; TOTP; sessions; export |
| Social      | `GET /feed`; CRUD `/posts`; likes/comments/shares; follow/friend/block; `/search`; `/notifications`; `/privacy`                 |
| Communities | CRUD `/servers`; discover/join/leave; members; categories; channels; overwrites; roles; invites; automod; audit log             |
| Moderation  | reports; kick; bans; mute; message delete; pins; global admin report queue                                                      |
| Messaging   | conversations/members; channel and conversation messages; threads; edit/delete; reactions; forward; search; receipts            |
| Media       | `POST /uploads`; authorized `GET /media/{encodedObjectKey}`                                                                     |
| Push        | Web Push subscriptions and Android FCM device tokens                                                                            |
| Realtime    | `GET /realtime/{channel                                                                                                         | conversation | voice}/{id}` with WebSocket Upgrade |

All resource routes verify ownership or membership after authenticating. Knowing an ID is never
sufficient authorization. Limits and schemas are centralized in `@nexa/shared`.
