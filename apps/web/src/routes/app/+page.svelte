<script lang="ts">
  import { Permission, hasPermission, type Channel } from '@nexa/shared';
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError, bootstrapSession, logout as apiLogout } from '../../lib/api';
  import type {
    Account,
    ApiData,
    ClientMessage,
    ServerDetail,
    ServerMember,
    ServerSummary,
    UserSummary,
  } from '../../lib/client-types';
  import { RealtimeConnection, type RealtimeEvent } from '../../lib/realtime';
  import AuthScreen from '../../lib/components/AuthScreen.svelte';
  import ChannelSidebar from '../../lib/components/ChannelSidebar.svelte';
  import ChatPanel from '../../lib/components/ChatPanel.svelte';
  import DmPanel from '../../lib/components/DmPanel.svelte';
  import FeedPanel from '../../lib/components/FeedPanel.svelte';
  import MemberPanel from '../../lib/components/MemberPanel.svelte';
  import Modal from '../../lib/components/Modal.svelte';
  import NotificationsPanel from '../../lib/components/NotificationsPanel.svelte';
  import ServerRail from '../../lib/components/ServerRail.svelte';
  import SettingsPanel from '../../lib/components/SettingsPanel.svelte';

  type View = 'community' | 'feed' | 'messages' | 'notifications' | 'settings';
  type VoiceState = 'connecting' | 'connected' | 'closed' | 'error';

  let booting = $state(true);
  let account = $state<Account | null>(null);
  let activeView = $state<View>('community');
  let servers = $state<ServerSummary[]>([]);
  let server = $state<ServerDetail | null>(null);
  let selectedServerId = $state<string | null>(null);
  let selectedChannel = $state<Channel | null>(null);
  let messages = $state<ClientMessage[]>([]);
  let messageCursor = $state<string | null>(null);
  let loadingMessages = $state(false);
  let members = $state<ServerMember[]>([]);
  let loadingMembers = $state(false);
  let typingIds = $state<string[]>([]);
  let online = $state(true);
  let mobileNavigationOpen = $state(false);
  let mobileChannelsOpen = $state(false);
  let mobileMembersOpen = $state(false);
  let createServerOpen = $state(false);
  let createChannelOpen = $state(false);
  let searchOpen = $state(false);
  let newServerName = $state('');
  let newServerDescription = $state('');
  let newServerVisibility = $state<'private' | 'public'>('private');
  let newChannelName = $state('');
  let newChannelType = $state<'text' | 'voice' | 'announcement'>('text');
  let newChannelCategory = $state<string | null>(null);
  let creating = $state(false);
  let searchQuery = $state('');
  let searchResults = $state<{ users: UserSummary[]; posts: unknown[]; servers: unknown[] }>({
    users: [],
    posts: [],
    servers: [],
  });
  let searching = $state(false);
  let voiceState = $state<VoiceState>('closed');
  let voiceMuted = $state(false);
  let remoteAudio = $state<Array<{ userId: string; stream: MediaStream }>>([]);
  let toasts = $state<Array<{ id: string; message: string; error: boolean }>>([]);
  let connection: RealtimeConnection | null = null;
  let voiceRoom: import('../../lib/voice').VoiceRoom | null = null;
  let typingTimeouts = new Map<string, number>();

  function notify(message: string, error = false): void {
    const id = crypto.randomUUID();
    toasts = [...toasts, { id, message, error }];
    window.setTimeout(() => (toasts = toasts.filter((toast) => toast.id !== id)), 4200);
  }

  async function bootstrap(): Promise<void> {
    booting = true;
    try {
      const refreshed = await bootstrapSession();
      if (!refreshed) return;
      const response = await api<ApiData<Account>>('/auth/me', { retryAuth: false });
      account = response.data;
      void import('../../lib/native').then(({ initializeNativePush }) => initializeNativePush());
      await joinPendingInvite();
      await loadServers();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        notify(error instanceof Error ? error.message : 'Could not start NEXA.', true);
      }
    } finally {
      booting = false;
    }
  }

  async function authenticated(nextAccount: Account): Promise<void> {
    account = nextAccount;
    void import('../../lib/native').then(({ initializeNativePush }) => initializeNativePush());
    await joinPendingInvite();
    await loadServers();
  }

  async function joinPendingInvite(): Promise<void> {
    const code = localStorage.getItem('nexa.pendingInvite');
    if (!code) return;
    try {
      await api(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST', body: '{}' });
      localStorage.removeItem('nexa.pendingInvite');
      notify('You joined the community.');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        localStorage.removeItem('nexa.pendingInvite');
        notify(error instanceof Error ? error.message : 'Invite could not be accepted.', true);
      }
    }
  }

  async function loadServers(): Promise<void> {
    const response = await api<ApiData<ServerSummary[]>>('/servers');
    servers = response.data;
    if (servers.length > 0) {
      const preferred =
        selectedServerId ?? localStorage.getItem('nexa.lastServer') ?? servers[0]!.id;
      const available = servers.find((item) => item.id === preferred) ?? servers[0]!;
      await selectServer(available.id);
    } else {
      activeView = 'feed';
    }
  }

  async function selectServer(serverId: string): Promise<void> {
    activeView = 'community';
    selectedServerId = serverId;
    localStorage.setItem('nexa.lastServer', serverId);
    mobileNavigationOpen = false;
    try {
      const response = await api<ApiData<ServerDetail>>(`/servers/${serverId}`);
      server = response.data;
      const nextChannel =
        response.data.channels.find((channel) => channel.id === selectedChannel?.id) ??
        response.data.channels[0] ??
        null;
      await loadMembers(serverId);
      if (nextChannel) await selectChannel(nextChannel);
      else selectedChannel = null;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open community.', true);
    }
  }

  async function loadMembers(serverId: string): Promise<void> {
    loadingMembers = true;
    try {
      const response = await api<ApiData<ServerMember[]>>(`/servers/${serverId}/members`);
      members = response.data;
    } finally {
      loadingMembers = false;
    }
  }

  async function selectChannel(channel: Channel): Promise<void> {
    selectedChannel = channel;
    mobileChannelsOpen = false;
    connection?.close();
    connection = null;
    leaveVoice();
    messages = [];
    messageCursor = null;
    typingIds = [];
    if (channel.type === 'voice') return;
    await loadMessages(false);
    connection = new RealtimeConnection('channel', channel.id);
    connection.subscribe(handleRealtime);
    connection.connect();
  }

  async function loadMessages(older: boolean): Promise<void> {
    if (!selectedChannel || selectedChannel.type === 'voice') return;
    loadingMessages = true;
    try {
      const query = older && messageCursor ? `?cursor=${encodeURIComponent(messageCursor)}` : '';
      const response = await api<ApiData<{ items: ClientMessage[]; nextCursor: string | null }>>(
        `/channels/${selectedChannel.id}/messages${query}`,
      );
      messages = older ? [...response.data.items, ...messages] : response.data.items;
      messageCursor = response.data.nextCursor;
      const last = messages.at(-1);
      if (last) void markRead(last.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load messages.', true);
    } finally {
      loadingMessages = false;
    }
  }

  function handleRealtime(event: RealtimeEvent): void {
    if (event.type === 'message.created') {
      const message = event.data as ClientMessage;
      if (message?.id && message.author && !messages.some((item) => item.id === message.id)) {
        messages = [...messages, message];
        if (message.author.id !== account?.id) void markRead(message.id);
      }
    } else if (event.type === 'message.updated') {
      const message = event.data as ClientMessage;
      messages = messages.map((item) => (item.id === message.id ? message : item));
    } else if (event.type === 'message.deleted') {
      const data = event.data as { id: string };
      messages = messages.map((message) =>
        message.id === data.id
          ? { ...message, content: '', attachments: [], deletedAt: new Date().toISOString() }
          : message,
      );
    } else if (event.type === 'message.reactions') {
      void loadMessages(false);
    } else if (event.type === 'typing') {
      const data = event.data as { userId: string; active: boolean };
      if (data.userId === account?.id) return;
      if (data.active) {
        typingIds = [...new Set([...typingIds, data.userId])];
        const prior = typingTimeouts.get(data.userId);
        if (prior) window.clearTimeout(prior);
        typingTimeouts.set(
          data.userId,
          window.setTimeout(() => (typingIds = typingIds.filter((id) => id !== data.userId)), 3500),
        );
      } else typingIds = typingIds.filter((id) => id !== data.userId);
    } else if (event.type === 'presence') {
      const data = event.data as { userId: string; status: UserSummary['status'] };
      members = members.map((member) =>
        member.user.id === data.userId
          ? { ...member, user: { ...member.user, status: data.status } }
          : member,
      );
    }
  }

  async function sendMessage(
    content: string,
    attachmentKeys: string[],
    replyTo: string | null,
  ): Promise<void> {
    if (!selectedChannel) return;
    try {
      const response = await api<{ data: ClientMessage }>(
        `/channels/${selectedChannel.id}/messages`,
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
      await loadMessages(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Reaction failed.', true);
    }
  }

  async function markRead(messageId: string): Promise<void> {
    if (!selectedChannel) return;
    try {
      await api(`/channels/${selectedChannel.id}/read/${messageId}`, { method: 'PUT' });
    } catch {
      // Read markers do not block chat use.
    }
  }

  function typingNames(): string[] {
    return typingIds.map(
      (id) => members.find((member) => member.user.id === id)?.user.displayName ?? 'Someone',
    );
  }

  async function createServer(): Promise<void> {
    if (!newServerName.trim()) return;
    creating = true;
    try {
      const response = await api<ApiData<{ id: string }>>('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: newServerName,
          description: newServerDescription,
          visibility: newServerVisibility,
        }),
      });
      createServerOpen = false;
      newServerName = '';
      newServerDescription = '';
      await loadServers();
      await selectServer(response.data.id);
      notify('Community created.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create community.', true);
    } finally {
      creating = false;
    }
  }

  async function createChannel(): Promise<void> {
    if (!server || !newChannelName.trim()) return;
    creating = true;
    try {
      const response = await api<ApiData<Channel>>(`/servers/${server.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          name: newChannelName,
          type: newChannelType,
          categoryId: newChannelCategory,
        }),
      });
      createChannelOpen = false;
      newChannelName = '';
      const serverResponse = await api<ApiData<ServerDetail>>(`/servers/${server.id}`);
      server = serverResponse.data;
      await selectChannel(response.data);
      notify('Channel created.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create channel.', true);
    } finally {
      creating = false;
    }
  }

  async function runSearch(): Promise<void> {
    if (searchQuery.trim().length < 2) return;
    searching = true;
    try {
      const response = await api<ApiData<typeof searchResults>>(
        `/search?q=${encodeURIComponent(searchQuery)}`,
      );
      searchResults = response.data;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Search failed.', true);
    } finally {
      searching = false;
    }
  }

  async function joinVoice(): Promise<void> {
    if (!selectedChannel || selectedChannel.type !== 'voice') return;
    try {
      const { VoiceRoom } = await import('../../lib/voice');
      voiceRoom = new VoiceRoom(
        selectedChannel.id,
        (userId, stream) => {
          remoteAudio = stream
            ? [...remoteAudio.filter((item) => item.userId !== userId), { userId, stream }]
            : remoteAudio.filter((item) => item.userId !== userId);
        },
        (state) => (voiceState = state),
      );
      await voiceRoom.join();
    } catch (error) {
      voiceState = 'error';
      notify(error instanceof Error ? error.message : 'Could not join voice.', true);
    }
  }

  function leaveVoice(): void {
    voiceRoom?.leave();
    voiceRoom = null;
    remoteAudio = [];
    voiceState = 'closed';
  }

  function attachAudio(node: HTMLAudioElement, stream: MediaStream) {
    node.srcObject = stream;
    void node.play().catch(() => undefined);
    return { destroy: () => (node.srcObject = null) };
  }

  function navigate(view: string): void {
    activeView = view as View;
    mobileNavigationOpen = false;
    mobileChannelsOpen = false;
    mobileMembersOpen = false;
    if (view !== 'community') {
      connection?.close();
      connection = null;
      leaveVoice();
    }
  }

  async function logout(): Promise<void> {
    connection?.close();
    leaveVoice();
    await apiLogout();
    account = null;
    servers = [];
    server = null;
  }

  function keyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchOpen = true;
      return;
    }
    if (!typing && event.altKey && selectedChannel && server) {
      const index = server.channels.findIndex((channel) => channel.id === selectedChannel?.id);
      if (event.key === 'ArrowDown' && server.channels[index + 1]) {
        event.preventDefault();
        void selectChannel(server.channels[index + 1]!);
      } else if (event.key === 'ArrowUp' && server.channels[index - 1]) {
        event.preventDefault();
        void selectChannel(server.channels[index - 1]!);
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      voiceMuted = !voiceMuted;
      voiceRoom?.setMuted(voiceMuted);
      notify(voiceMuted ? 'Microphone muted.' : 'Microphone unmuted.');
    }
  }

  function connectivity(): void {
    online = navigator.onLine;
  }

  onMount(() => {
    online = navigator.onLine;
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    void bootstrap();
  });

  onDestroy(() => {
    connection?.close();
    leaveVoice();
    window.removeEventListener('online', connectivity);
    window.removeEventListener('offline', connectivity);
    for (const timeout of typingTimeouts.values()) window.clearTimeout(timeout);
  });
</script>

<svelte:window onkeydown={keyboard} />
<svelte:head><title>NEXA — Communities & chat</title></svelte:head>

{#if booting}
  <main class="boot-screen">
    <div class="boot-mark">N</div>
    <span>Loading NEXA</span>
  </main>
{:else if !account}
  <AuthScreen onAuthenticated={authenticated} />
{:else}
  {#if !online}<div class="offline-banner" role="status">
      You are offline — showing cached content
    </div>{/if}
  <div class="app-shell">
    <ServerRail
      {servers}
      {selectedServerId}
      {activeView}
      mobileOpen={mobileNavigationOpen}
      onSelect={(id) => void selectServer(id)}
      onNavigate={navigate}
      onCreate={() => (createServerOpen = true)}
    />

    {#if activeView === 'community'}
      <ChannelSidebar
        {server}
        currentUser={account}
        selectedChannelId={selectedChannel?.id ?? null}
        mobileOpen={mobileChannelsOpen}
        onSelectChannel={(channel) => void selectChannel(channel)}
        onCreateChannel={(categoryId) => {
          newChannelCategory = categoryId ?? null;
          createChannelOpen = true;
        }}
        onOpenSettings={() => navigate('settings')}
        onSearch={() => (searchOpen = true)}
      />
      <ChatPanel
        channel={selectedChannel}
        {messages}
        currentUserId={account.id}
        loading={loadingMessages}
        hasOlder={Boolean(messageCursor)}
        typingUsers={typingNames()}
        {voiceState}
        onSend={sendMessage}
        onLoadOlder={() => void loadMessages(true)}
        onReact={react}
        onRead={(id) => void markRead(id)}
        onTyping={(active) => connection?.send('typing', { active })}
        onJoinVoice={() => void joinVoice()}
        onLeaveVoice={leaveVoice}
        onToggleSidebar={() => (mobileChannelsOpen = !mobileChannelsOpen)}
        onToggleMembers={() => (mobileMembersOpen = !mobileMembersOpen)}
        onSearch={() => (searchOpen = true)}
      />
      <MemberPanel {members} loading={loadingMembers} mobileOpen={mobileMembersOpen} />
    {:else if activeView === 'feed'}
      <FeedPanel
        currentUser={account}
        onToggleNavigation={() => (mobileNavigationOpen = !mobileNavigationOpen)}
        {notify}
      />
    {:else if activeView === 'messages'}
      <DmPanel
        currentUser={account}
        onToggleNavigation={() => (mobileNavigationOpen = !mobileNavigationOpen)}
        {notify}
      />
    {:else if activeView === 'notifications'}
      <NotificationsPanel
        onToggleNavigation={() => (mobileNavigationOpen = !mobileNavigationOpen)}
        {notify}
      />
    {:else if activeView === 'settings'}
      <SettingsPanel
        {account}
        onUpdated={(updated) => (account = updated)}
        onLogout={() => void logout()}
        onToggleNavigation={() => (mobileNavigationOpen = !mobileNavigationOpen)}
        {notify}
      />
    {/if}
  </div>

  <nav class="mobile-nav" aria-label="Mobile navigation">
    <button
      class:active={activeView === 'community'}
      type="button"
      onclick={() => navigate('community')}><span>◈</span><span>Servers</span></button
    >
    <button
      class:active={activeView === 'messages'}
      type="button"
      onclick={() => navigate('messages')}><span>✉</span><span>Messages</span></button
    >
    <button class:active={activeView === 'feed'} type="button" onclick={() => navigate('feed')}
      ><span>⌁</span><span>Feed</span></button
    >
    <button
      class:active={activeView === 'notifications'}
      type="button"
      onclick={() => navigate('notifications')}><span>♢</span><span>Alerts</span></button
    >
    <button
      class:active={activeView === 'settings'}
      type="button"
      onclick={() => navigate('settings')}><span>⚙</span><span>Settings</span></button
    >
  </nav>

  {#each remoteAudio as remote (remote.userId)}
    <audio class="sr-only" autoplay use:attachAudio={remote.stream}><track kind="captions" /></audio
    >
  {/each}

  {#if createServerOpen}
    <Modal title="Create a community" onClose={() => (createServerOpen = false)}>
      {#snippet children()}
        <div class="modal-form">
          <div class="field">
            <label for="server-name">Name</label><input
              id="server-name"
              bind:value={newServerName}
              maxlength="80"
              placeholder="Design collective"
            />
          </div>
          <div class="field">
            <label for="server-description">Description</label><textarea
              id="server-description"
              bind:value={newServerDescription}
              maxlength="500"
              rows="3"></textarea>
          </div>
          <div class="field">
            <label for="server-visibility">Visibility</label><select
              id="server-visibility"
              bind:value={newServerVisibility}
              ><option value="private">Private — invite only</option><option value="public"
                >Public — discoverable</option
              ></select
            >
          </div>
        </div>
      {/snippet}
      {#snippet actions()}<button
          class="ghost-button"
          type="button"
          onclick={() => (createServerOpen = false)}>Cancel</button
        ><button
          class="primary-button"
          type="button"
          onclick={() => void createServer()}
          disabled={creating || !newServerName.trim()}>{creating ? 'Creating…' : 'Create'}</button
        >{/snippet}
    </Modal>
  {/if}

  {#if createChannelOpen && server}
    <Modal title="Create a channel" onClose={() => (createChannelOpen = false)}>
      {#snippet children()}
        <div class="modal-form">
          <div class="field">
            <label for="channel-name">Channel name</label><input
              id="channel-name"
              bind:value={newChannelName}
              maxlength="80"
              placeholder="project-updates"
            />
          </div>
          <div class="field">
            <label for="channel-type">Type</label><select
              id="channel-type"
              bind:value={newChannelType}
              ><option value="text"># Text</option><option value="voice">◖ Voice</option><option
                value="announcement">◉ Announcement</option
              ></select
            >
          </div>
          {#if server?.categories.length}<div class="field">
              <label for="channel-category">Category</label><select
                id="channel-category"
                bind:value={newChannelCategory}
                ><option value={null}>No category</option
                >{#each server?.categories ?? [] as category}<option value={category.id}
                    >{category.name}</option
                  >{/each}</select
              >
            </div>{/if}
        </div>
      {/snippet}
      {#snippet actions()}<button
          class="ghost-button"
          type="button"
          onclick={() => (createChannelOpen = false)}>Cancel</button
        ><button
          class="primary-button"
          type="button"
          onclick={() => void createChannel()}
          disabled={creating || !newChannelName.trim()}
          >{creating ? 'Creating…' : 'Create channel'}</button
        >{/snippet}
    </Modal>
  {/if}

  {#if searchOpen}
    <Modal title="Search NEXA" onClose={() => (searchOpen = false)}>
      {#snippet children()}
        <div class="search-box">
          <input
            class="text-input"
            bind:value={searchQuery}
            placeholder="People, posts, and communities"
            onkeydown={(event) => event.key === 'Enter' && void runSearch()}
          /><button
            class="primary-button"
            type="button"
            onclick={() => void runSearch()}
            disabled={searching}>{searching ? '…' : 'Search'}</button
          >
        </div>
        <div class="search-results">
          {#each searchResults.users as user (user.id)}<button type="button"
              ><span class="result-icon">@</span><span
                ><strong>{user.displayName}</strong><small>@{user.username}</small></span
              ></button
            >{/each}
          {#each searchResults.servers as result}<div class="result-static">
              <span class="result-icon">◈</span><span
                ><strong>{String((result as { name?: unknown }).name ?? 'Community')}</strong><small
                  >Community</small
                ></span
              >
            </div>{/each}
          {#each searchResults.posts as result}<div class="result-static">
              <span class="result-icon">⌁</span><span
                ><strong>Post</strong><small
                  >{String((result as { body?: unknown }).body ?? '').slice(0, 90)}</small
                ></span
              >
            </div>{/each}
          {#if !searching && searchResults.users.length + searchResults.servers.length + searchResults.posts.length === 0}<p
              class="muted search-hint"
            >
              Press Enter to search. Shortcut: Ctrl/⌘ K
            </p>{/if}
        </div>
      {/snippet}
    </Modal>
  {/if}

  <div class="toast-stack" aria-live="polite">
    {#each toasts as toast (toast.id)}<div class:error={toast.error} class="toast">
        <span>{toast.error ? '!' : '✓'}</span><span>{toast.message}</span>
      </div>{/each}
  </div>
{/if}

<style>
  .boot-screen {
    display: grid;
    width: 100vw;
    height: 100dvh;
    place-content: center;
    justify-items: center;
    gap: 14px;
    background: var(--bg-deep);
    color: var(--text-muted);
  }
  .boot-mark {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 20px;
    background: linear-gradient(135deg, #a78bfa, #6d28d9);
    color: white;
    font-size: 1.6rem;
    font-weight: 900;
    box-shadow: 0 15px 50px rgb(109 40 217 / 35%);
  }
  .boot-screen span {
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .modal-form {
    display: grid;
    gap: 16px;
  }
  .search-box {
    display: flex;
    gap: 7px;
  }
  .search-results {
    display: grid;
    gap: 3px;
    max-height: 390px;
    margin-top: 14px;
    overflow-y: auto;
  }
  .search-results button,
  .result-static {
    display: flex;
    min-height: 52px;
    align-items: center;
    gap: 10px;
    padding: 7px;
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    text-align: start;
  }
  .search-results button:hover {
    background: var(--bg-hover);
  }
  .search-results span:nth-child(2) {
    min-width: 0;
  }
  .search-results strong,
  .search-results small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search-results small {
    color: var(--text-muted);
    font-size: 0.68rem;
  }
  .result-icon {
    display: grid;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 10px;
    background: var(--brand-soft);
    color: #a78bfa;
  }
  .search-hint {
    text-align: center;
  }
</style>
