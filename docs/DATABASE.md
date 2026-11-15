# Database schema

The executable source of truth is `backend/migrations/*.sql`. D1 foreign keys are enabled, IDs are
opaque UUID-prefixed strings, timestamps are UTC ISO-8601 text (session expiries are Unix seconds),
and high-volume lookups have composite indexes.

```mermaid
erDiagram
  users ||--o{ sessions : owns
  users ||--o{ posts : authors
  posts ||--o{ comments : contains
  posts ||--o{ post_media : attaches
  uploads ||--o{ post_media : referenced
  users ||--o{ server_members : joins
  servers ||--o{ server_members : contains
  servers ||--o{ roles : defines
  server_members ||--o{ member_roles : assigned
  roles ||--o{ member_roles : assigned
  servers ||--o{ channels : contains
  channels ||--o{ channel_overwrites : controls
  conversations ||--o{ conversation_members : contains
  users ||--o{ conversation_members : joins
  channels ||--o{ messages : receives
  conversations ||--o{ messages : receives
  messages ||--o{ message_attachments : attaches
  uploads ||--o{ message_attachments : referenced
  messages ||--o{ message_reactions : receives
  users ||--o{ notifications : receives
  servers ||--o{ audit_logs : records
```

## Important invariants

- A message belongs to exactly one channel or conversation.
- `UNIQUE(author_id, client_nonce)` makes message retries idempotent.
- One `@everyone` role is allowed per server; owners are evaluated as administrators server-side.
- Refresh token hashes and one previous hash are unique. Seeing the previous token revokes every
  active session for that account.
- Deleting a user cascades authored relational data. Media objects are explicitly deleted before the
  user row because object storage is not relational.
- Soft-deleted messages preserve ordering/replies but lose content, attachments, and reactions.

## Search

The MVP uses bounded `LIKE` searches after authorization. At higher scale, move public discovery to
a dedicated index; never copy private message text into a third-party search provider without an
explicit privacy change and migration plan.
