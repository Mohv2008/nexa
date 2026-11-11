<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api } from '../api';
  import type { Account, ApiData, ClientMessage, Conversation, UserSummary } from '../client-types';
  import { RealtimeConnection, type RealtimeEvent } from '../realtime';
  import Avatar from './Avatar.svelte';
  import ChatPanel from './ChatPanel.svelte';

  let {
    currentUser,
    onToggleNavigation,
    notify,
  }: {
    currentUser: Account;
    onToggleNavigation: () => void;
    notify: (message: string, error?: boolean) => void;
  } = $props();

  let conversations = $state<Conversation[]>([]);
  let selected = $state<Conversation | null>(null);
  let messages = $state<ClientMessage[]>([]);
  let loading = $state(true);
  let loadingMessages = $state(false);
  let showList = $state(true);
  let showNew = $state(false);
  let search = $state('');
  let searchResults = $state<UserSummary[]>([]);
  let searching = $state(false);
  let typingIds = $state<string[]>([]);
  let connection: RealtimeConnection | null = null;
  let typingTimeouts = new Map<string, number>();

  async function loadConversations(): Promise<void> {
    loading = true;
    try {
      const response = await api<ApiData<Conversation[]>>('/conversations');
      conversations = response.data;
      if (!selected && conversations[0]) await selectConversation(conversations[0]);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load messages.', true);
    } finally {
      loading = false;
    }
  }

  async function selectConversation(conversation: Conversation): Promise<void> {
    selected = conversation;
    showList = false;
    loadingMessages = true;
    connection?.close();
    try {
      const response = await api<ApiData<{ items: ClientMessage[]; nextCursor: string | null }>>(
        `/conversations/${conversation.id}/messages`,
      );
      messages = response.data.items;
      connection = new RealtimeConnection('conversation', conversation.id);
      connection.subscribe(handleRealtime);
      connection.connect();
      const last = messages.at(-1);
      if (last) await markRead(last.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load conversation.', true);
    } finally {
      loadingMessages = false;
    }
  }

  function handleRealtime(event: RealtimeEvent): void {
    if (event.type === 'message.created') {
      const message = event.data as ClientMessage;
      if (message?.id && !messages.some((item) => item.id === message.id)) {
        messages = [...messages, message];
        if (message.author?.id !== currentUser.id) void markRead(message.id);
      }
    } else if (event.type === 'message.updated') {
      const message = event.data as ClientMessage;
      messages = messages.map((item) => (item.id === message.id ? message : item));
    } else if (event.type === 'message.deleted') {
      const data = event.data as { id: string };
      messages = messages.map((item) =>
        item.id === data.id ? { ...item, content: '', deletedAt: new Date().toISOString() } : item,
      );
    } else if (event.type === 'typing') {
      const data = event.data as { userId: string; active: boolean };
      if (data.userId === currentUser.id) return;
      if (data.active) {
        typingIds = [...new Set([...typingIds, data.userId])];
        const existing = typingTimeouts.get(data.userId);
        if (existing) window.clearTimeout(existing);
        typingTimeouts.set(
          data.userId,
          window.setTimeout(() => (typingIds = typingIds.filter((id) => id !== data.userId)), 3500),
        );
      } else typingIds = typingIds.filter((id) => id !== data.userId);
    }
  }

  async function send(
    content: string,
    attachmentKeys: string[],
    replyTo: string | null,
  ): Promise<void> {
    if (!selected) return;
    try {
      const response = await api<{ data: ClientMessage }>(
        `/conversations/${selected.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content,
            attachmentKeys,
            replyTo,
            clientNonce: crypto.randomUUID(),
          }),
        },
      );
      if (!messages.some((message) => message.id === response.data.id)) {
        messages = [...messages, response.data];
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be sent.', true);
      throw error;
    }
  }

  async function react(messageId: string, emoji: string, reacted: boolean): Promise<void> {
    try {
      if (reacted) {
        await api(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
          method: 'DELETE',
        });
      } else {
        await api(`/messages/${messageId}/reactions`, {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        });
      }
      if (selected) {
        const response = await api<ApiData<{ items: ClientMessage[] }>>(
          `/conversations/${selected.id}/messages`,
        );
        messages = response.data.items;
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Reaction failed.', true);
    }
  }

  async function markRead(messageId: string): Promise<void> {
    if (!selected) return;
    try {
      await api(`/conversations/${selected.id}/read/${messageId}`, { method: 'PUT' });
      conversations = conversations.map((item) =>
        item.id === selected?.id ? { ...item, unreadCount: 0 } : item,
      );
    } catch {
      // Read receipts should not interrupt a conversation.
    }
  }

  async function findPeople(): Promise<void> {
    if (search.trim().length < 2) return;
    searching = true;
    try {
      const response = await api<ApiData<{ users: UserSummary[] }>>(
        `/search?q=${encodeURIComponent(search)}&type=users`,
      );
      searchResults = response.data.users.filter((user) => user.id !== currentUser.id);
    } finally {
      searching = false;
    }
  }

  async function startConversation(user: UserSummary): Promise<void> {
    try {
      const response = await api<ApiData<{ id: string }>>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ memberIds: [user.id] }),
      });
      showNew = false;
      search = '';
      await loadConversations();
      const conversation = conversations.find((item) => item.id === response.data.id);
      if (conversation) await selectConversation(conversation);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not start conversation.', true);
    }
  }

  function conversationName(conversation: Conversation): string {
    if (conversation.name) return conversation.name;
    return (
      conversation.members.find((member) => member.id !== currentUser.id)?.displayName ??
      'Conversation'
    );
  }

  function conversationAvatar(conversation: Conversation): UserSummary | undefined {
    return conversation.members.find((member) => member.id !== currentUser.id);
  }

  function typingNames(): string[] {
    return typingIds.map(
      (id) => selected?.members.find((member) => member.id === id)?.displayName ?? 'Someone',
    );
  }

  onMount(() => void loadConversations());
  onDestroy(() => {
    connection?.close();
    for (const timeout of typingTimeouts.values()) window.clearTimeout(timeout);
  });
</script>

<main class="dm-layout">
  <aside class:mobile-hidden={!showList} class="dm-sidebar">
    <header class="panel-header dm-heading">
      <button
        class="icon-button mobile-only"
        type="button"
        onclick={onToggleNavigation}
        aria-label="Open navigation">☰</button
      >
      <h1>Messages</h1>
      <span class="header-spacer"></span>
      <button
        class="icon-button"
        type="button"
        onclick={() => (showNew = !showNew)}
        aria-label="New message">✎</button
      >
    </header>
    {#if showNew}
      <div class="people-search">
        <div>
          <input
            bind:value={search}
            placeholder="Find a person…"
            onkeydown={(event) => event.key === 'Enter' && void findPeople()}
          /><button type="button" onclick={() => void findPeople()}>⌕</button>
        </div>
        {#if searching}<small>Searching…</small>{/if}
        {#each searchResults as user (user.id)}
          <button class="person-result" type="button" onclick={() => void startConversation(user)}
            ><Avatar
              src={user.avatarUrl}
              name={user.displayName}
              status={user.status}
              size={34}
            /><span><strong>{user.displayName}</strong><small>@{user.username}</small></span
            ></button
          >
        {/each}
      </div>
    {/if}
    <div class="conversation-list">
      {#if loading}
        {#each Array(7) as _}<div class="conversation-skeleton">
            <i class="skeleton"></i><span class="skeleton"></span>
          </div>{/each}
      {:else if conversations.length === 0}
        <div class="empty-state">
          <div class="empty-icon">✉</div>
          <strong>No messages yet</strong>
          <p>Start a private conversation.</p>
        </div>
      {:else}
        {#each conversations as conversation (conversation.id)}
          {@const other = conversationAvatar(conversation)}
          <button
            class:active={selected?.id === conversation.id}
            class="conversation-row"
            type="button"
            onclick={() => void selectConversation(conversation)}
          >
            <Avatar
              src={other?.avatarUrl}
              name={conversationName(conversation)}
              status={other?.status}
              size={42}
            />
            <span class="conversation-copy"
              ><strong>{conversationName(conversation)}</strong><small
                >{conversation.lastMessage ?? 'Start the conversation'}</small
              ></span
            >
            {#if conversation.unreadCount}<b>{conversation.unreadCount}</b>{/if}
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class:mobile-hidden={showList} class="dm-chat">
    <ChatPanel
      channel={null}
      title={selected ? conversationName(selected) : undefined}
      subtitle={selected?.type === 'group'
        ? `${selected.members.length} members`
        : selected
          ? 'Private conversation'
          : ''}
      {messages}
      currentUserId={currentUser.id}
      loading={loadingMessages}
      typingUsers={typingNames()}
      onSend={send}
      onLoadOlder={() => {}}
      onReact={react}
      onRead={(id) => void markRead(id)}
      onTyping={(active) => connection?.send('typing', { active })}
      onJoinVoice={() => notify('Voice calls are available from community voice channels.')}
      onLeaveVoice={() => {}}
      onToggleSidebar={() => (showList = true)}
      onToggleMembers={() => {}}
      onSearch={() => {}}
    />
  </section>
</main>

<style>
  .dm-layout {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-column: 2 / -1;
    grid-template-columns: 290px minmax(0, 1fr);
    background: var(--bg-panel);
  }
  .dm-sidebar {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border-inline-end: 1px solid var(--line);
    background: var(--bg-sidebar);
  }
  .dm-heading {
    background: var(--bg-sidebar);
  }
  .conversation-list {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .conversation-row,
  .person-result {
    display: flex;
    width: 100%;
    min-height: 58px;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    border-radius: 10px;
    background: transparent;
    color: var(--text-soft);
    text-align: start;
  }
  .conversation-row:hover,
  .conversation-row.active,
  .person-result:hover {
    background: var(--bg-hover);
  }
  .conversation-row.active {
    box-shadow: inset 3px 0 var(--brand);
  }
  :global([dir='rtl']) .conversation-row.active {
    box-shadow: inset -3px 0 var(--brand);
  }
  .conversation-copy {
    min-width: 0;
    flex: 1;
  }
  .conversation-copy strong,
  .conversation-copy small,
  .person-result strong,
  .person-result small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conversation-copy strong,
  .person-result strong {
    color: var(--text);
    font-size: 0.8rem;
  }
  .conversation-copy small,
  .person-result small {
    color: var(--text-muted);
    font-size: 0.68rem;
  }
  .conversation-row b {
    min-width: 19px;
    border-radius: 10px;
    background: var(--brand);
    color: white;
    font-size: 0.65rem;
    text-align: center;
  }
  .conversation-skeleton {
    display: grid;
    grid-template-columns: 42px 1fr;
    gap: 10px;
    padding: 8px;
  }
  .conversation-skeleton i {
    width: 42px;
    height: 42px;
    border-radius: 50%;
  }
  .conversation-skeleton span {
    height: 30px;
  }
  .people-search {
    padding: 9px;
    border-block-end: 1px solid var(--line);
  }
  .people-search > div {
    display: flex;
  }
  .people-search input {
    min-width: 0;
    flex: 1;
    border: 1px solid var(--line);
    border-radius: 8px 0 0 8px;
    background: var(--bg-input);
    color: var(--text);
    padding: 7px 9px;
  }
  :global([dir='rtl']) .people-search input {
    border-radius: 0 8px 8px 0;
  }
  .people-search > div > button {
    width: 36px;
    border-radius: 0 8px 8px 0;
    background: var(--brand);
    color: white;
  }
  :global([dir='rtl']) .people-search > div > button {
    border-radius: 8px 0 0 8px;
  }
  .people-search > small {
    color: var(--text-muted);
  }
  .dm-chat {
    min-width: 0;
    min-height: 0;
  }
  .dm-chat :global(.chat-panel) {
    height: 100%;
  }
  @media (max-width: 720px) {
    .dm-layout {
      display: block;
      height: calc(100dvh - 58px);
    }
    .dm-sidebar,
    .dm-chat {
      height: 100%;
    }
    .mobile-hidden {
      display: none;
    }
  }
</style>
