ALTER TABLE users ADD COLUMN privacy_json TEXT NOT NULL
  DEFAULT '{"discoverable":true,"dmFrom":"everyone","showStatus":true}';

ALTER TABLE servers ADD COLUMN automod_json TEXT NOT NULL
  DEFAULT '{"maxMessages":8,"windowSeconds":10,"blockLinks":false,"bannedWords":[]}';

ALTER TABLE messages ADD COLUMN forwarded_from_id TEXT REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE channel_reads (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX device_tokens_user_idx ON device_tokens(user_id);
