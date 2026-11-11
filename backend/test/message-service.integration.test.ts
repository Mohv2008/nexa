import { DEFAULT_MEMBER_PERMISSIONS, Permission } from '@nexa/shared';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import {
  authorizeMessageTarget,
  createMessage,
  validateMessageInput,
} from '../src/lib/message-service';

const bindings = env as unknown as Bindings;
const owner = 'usr_message_owner';
const member = 'usr_message_member';
const server = 'srv_message_test';
const channel = 'chn_message_test';
const announcement = 'chn_message_announcement';
const conversation = 'cnv_message_test';

beforeAll(async () => {
  for (const [id, suffix] of [
    [owner, 'owner'],
    [member, 'member'],
  ]) {
    await bindings.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, birth_date)
       VALUES (?, ?, ?, ?, 'hash', '2000-01-01')`,
    )
      .bind(id, `${suffix}-messages@example.com`, `${suffix}_messages`, suffix)
      .run();
  }
  await bindings.DB.batch([
    bindings.DB.prepare("INSERT INTO servers (id, owner_id, name) VALUES (?, ?, 'Messages')").bind(
      server,
      owner,
    ),
    bindings.DB.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').bind(
      server,
      owner,
    ),
    bindings.DB.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').bind(
      server,
      member,
    ),
    bindings.DB.prepare(
      "INSERT INTO roles (id, server_id, name, permissions, is_everyone) VALUES ('rol_messages', ?, '@everyone', ?, 1)",
    ).bind(server, DEFAULT_MEMBER_PERMISSIONS),
    bindings.DB.prepare(
      "INSERT INTO channels (id, server_id, name, type, slow_mode_seconds) VALUES (?, ?, 'chat', 'text', 60)",
    ).bind(channel, server),
    bindings.DB.prepare(
      "INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, 'news', 'announcement')",
    ).bind(announcement, server),
    bindings.DB.prepare("INSERT INTO conversations (id, type) VALUES (?, 'direct')").bind(
      conversation,
    ),
    bindings.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')",
    ).bind(conversation, owner),
    bindings.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')",
    ).bind(conversation, member),
    bindings.DB.prepare(
      "INSERT INTO uploads (id, owner_id, object_key, original_name, mime_type, byte_size) VALUES ('upl_message', ?, 'key/file.txt', 'file.txt', 'text/plain', 4)",
    ).bind(member),
  ]);
});

describe('message service', () => {
  it('validates bounded, non-empty messages', () => {
    expect(
      validateMessageInput({ content: '  hello  ', clientNonce: 'nonce-valid-1' }).content,
    ).toBe('hello');
    expect(() => validateMessageInput({ content: '', clientNonce: 'nonce-empty-1' })).toThrowError(
      /text or an attachment/u,
    );
    expect(() =>
      validateMessageInput({ content: 'x'.repeat(5000), clientNonce: 'nonce-long-1' }),
    ).toThrowError(/invalid/u);
  });

  it('creates idempotent DMs with attachments and replies', async () => {
    const input = {
      content: 'first dm',
      clientNonce: 'nonce-dm-first',
      attachmentKeys: ['key/file.txt'],
    };
    const first = await createMessage(
      bindings.DB,
      member,
      { kind: 'conversation', id: conversation },
      input,
    );
    expect(first.duplicate).toBe(false);
    const duplicate = await createMessage(
      bindings.DB,
      member,
      { kind: 'conversation', id: conversation },
      input,
    );
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    const reply = await createMessage(
      bindings.DB,
      owner,
      { kind: 'conversation', id: conversation },
      { content: 'reply', clientNonce: 'nonce-dm-reply', replyTo: first.id },
    );
    expect(reply.id).toMatch(/^msg_/u);
    await expect(
      createMessage(
        bindings.DB,
        owner,
        { kind: 'conversation', id: conversation },
        {
          content: 'bad reference',
          clientNonce: 'nonce-dm-bad-ref',
          replyTo: 'msg_00000000-0000-0000-0000-000000000000',
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_reference' });
  });

  it('enforces upload ownership and conversation membership', async () => {
    await expect(
      createMessage(
        bindings.DB,
        owner,
        { kind: 'conversation', id: conversation },
        { content: '', clientNonce: 'nonce-bad-upload', attachmentKeys: ['key/file.txt'] },
      ),
    ).rejects.toMatchObject({ code: 'invalid_upload' });
    await expect(
      authorizeMessageTarget(bindings.DB, 'usr_missing', {
        kind: 'conversation',
        id: conversation,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('enforces slow mode, mute, automod, and announcement permissions', async () => {
    const first = await createMessage(
      bindings.DB,
      member,
      { kind: 'channel', id: channel },
      { content: 'channel hello', clientNonce: 'nonce-channel-first' },
      1_800_000,
    );
    expect(first.id).toMatch(/^msg_/u);
    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: channel },
        { content: 'too soon', clientNonce: 'nonce-channel-slow' },
        1_801_000,
      ),
    ).rejects.toMatchObject({ code: 'slow_mode' });

    await bindings.DB.prepare('UPDATE channels SET slow_mode_seconds = 0 WHERE id = ?')
      .bind(channel)
      .run();
    await bindings.DB.prepare(
      `UPDATE servers SET automod_json = '{"maxMessages":8,"windowSeconds":10,"blockLinks":true,"bannedWords":["blocked"]}' WHERE id = ?`,
    )
      .bind(server)
      .run();
    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: channel },
        { content: 'https://example.com', clientNonce: 'nonce-channel-link' },
      ),
    ).rejects.toMatchObject({ code: 'automod_blocked' });
    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: channel },
        { content: 'a blocked phrase', clientNonce: 'nonce-channel-word' },
      ),
    ).rejects.toMatchObject({ code: 'automod_blocked' });

    await bindings.DB.prepare(
      'UPDATE server_members SET muted_until = ? WHERE server_id = ? AND user_id = ?',
    )
      .bind(Math.floor(Date.now() / 1000) + 300, server, member)
      .run();
    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: channel },
        { content: 'muted', clientNonce: 'nonce-channel-muted' },
      ),
    ).rejects.toMatchObject({ code: 'muted' });
    await bindings.DB.prepare(
      'UPDATE server_members SET muted_until = NULL WHERE server_id = ? AND user_id = ?',
    )
      .bind(server, member)
      .run();

    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: announcement },
        { content: 'news', clientNonce: 'nonce-announcement-member' },
      ),
    ).rejects.toMatchObject({ code: 'missing_permission' });
    const ownerPost = await createMessage(
      bindings.DB,
      owner,
      { kind: 'channel', id: announcement },
      { content: 'official news', clientNonce: 'nonce-announcement-owner' },
    );
    expect(ownerPost.id).toMatch(/^msg_/u);
  });

  it('rejects voice and missing channels', async () => {
    await bindings.DB.prepare(
      "INSERT INTO channels (id, server_id, name, type) VALUES ('chn_voice_test', ?, 'voice', 'voice')",
    )
      .bind(server)
      .run();
    await expect(
      createMessage(
        bindings.DB,
        member,
        { kind: 'channel', id: 'chn_voice_test' },
        { content: 'nope', clientNonce: 'nonce-voice-message' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_channel' });
    await expect(
      authorizeMessageTarget(bindings.DB, member, { kind: 'channel', id: 'chn_missing' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
