# Realtime protocol

Connect to `wss://API/v1/realtime/{kind}/{roomId}`. Browser cookies authenticate the Upgrade and the
Worker verifies channel permissions or conversation membership before forwarding it to a Durable
Object. Origins outside `ALLOWED_ORIGINS` are rejected.

Each JSON frame is capped at 16 KiB. More than 60 events in ten seconds is rate-limited; sustained
abuse closes the socket. Slow mode and automod are additional database-backed controls.

## Client events

| Event            | Data                       | Persistence                              |
| ---------------- | -------------------------- | ---------------------------------------- |
| `ping`           | `{}`                       | none; server returns `pong`              |
| `typing`         | `{ active: boolean }`      | none                                     |
| `presence`       | `{ status: online          | idle                                     | dnd }` | none |
| `read`           | `{ messageId }`            | updates room read marker                 |
| `message.create` | shared `messageSchema`     | D1, idempotent by nonce                  |
| `signal`         | `{ targetUserId, signal }` | voice rooms only; directed WebRTC signal |

## Server events

`ready`, `pong`, `typing`, `presence`, `read`, `message.created`, `message.updated`,
`message.deleted`, `message.reactions`, `signal`, and `error`.

Every event checks that its D1 session is still active and re-checks room access. This means account
logout/session revocation takes effect on the next frame without relying on trusted client state.
The client pauses heartbeat/reconnect timers while hidden and uses jittered exponential backoff.

## Ordering and duplicates

A room Durable Object serializes inbound events, but reconnecting clients must still handle retries.
Messages have `(author_id, client_nonce)` uniqueness and clients deduplicate server events by message
ID. History remains authoritative and is fetched by cursor after reconnect.

## Voice

The voice room uses signaling only; audio flows directly over WebRTC using Opus. The server limits a
room to six unique users. Public STUN does not relay media, so restrictive NAT pairs can fail. The
production fallback is Cloudflare Realtime TURN/SFU; its 2026 shared free allowance is documented in
[FREE_TIER.md](FREE_TIER.md).
