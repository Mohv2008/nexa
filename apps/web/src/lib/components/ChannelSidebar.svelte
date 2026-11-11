<script lang="ts">
  import { Permission, hasPermission } from '@nexa/shared';
  import type { Account, Channel, ServerDetail } from '../client-types';
  import Avatar from './Avatar.svelte';

  let {
    server,
    currentUser,
    selectedChannelId,
    mobileOpen = false,
    onSelectChannel,
    onCreateChannel,
    onOpenSettings,
    onSearch,
  }: {
    server: ServerDetail | null;
    currentUser: Account;
    selectedChannelId: string | null;
    mobileOpen?: boolean;
    onSelectChannel: (channel: Channel) => void;
    onCreateChannel: (categoryId?: string) => void;
    onOpenSettings: () => void;
    onSearch: () => void;
  } = $props();

  const uncategorized = $derived(server?.channels.filter((channel) => !channel.categoryId) ?? []);

  function channelsFor(categoryId: string): Channel[] {
    return server?.channels.filter((channel) => channel.categoryId === categoryId) ?? [];
  }
</script>

<aside class={`channel-sidebar${mobileOpen ? ' mobile-open' : ''}`} aria-label="Channels">
  {#if server}
    <header class="server-heading">
      <div>
        <strong>{server.name}</strong>
        <small>{server.memberCount} members</small>
      </div>
      <button
        class="icon-button"
        type="button"
        onclick={onSearch}
        aria-label="Search community"
        title="Search">⌕</button
      >
    </header>

    <div class="channel-scroll">
      <section class="channel-section">
        <div class="section-heading">
          <span>CHANNELS</span>
          {#if hasPermission(server.permissions, Permission.MANAGE_CHANNELS)}
            <button type="button" onclick={() => onCreateChannel()} aria-label="Create channel"
              >＋</button
            >
          {/if}
        </div>
        {#each uncategorized as channel (channel.id)}
          <button
            class:active={channel.id === selectedChannelId}
            class="channel-link"
            type="button"
            onclick={() => onSelectChannel(channel)}
          >
            <span class="channel-glyph" aria-hidden="true"
              >{channel.type === 'voice' ? '◖' : channel.type === 'announcement' ? '◉' : '#'}</span
            >
            <span>{channel.name}</span>
            {#if channel.unreadCount}<b>{channel.unreadCount}</b>{/if}
          </button>
        {/each}
      </section>

      {#each server.categories as category (category.id)}
        <section class="channel-section">
          <div class="section-heading">
            <span>{category.name.toUpperCase()}</span>
            {#if hasPermission(server.permissions, Permission.MANAGE_CHANNELS)}
              <button
                type="button"
                onclick={() => onCreateChannel(category.id)}
                aria-label={`Create channel in ${category.name}`}>＋</button
              >
            {/if}
          </div>
          {#each channelsFor(category.id) as channel (channel.id)}
            <button
              class:active={channel.id === selectedChannelId}
              class="channel-link"
              type="button"
              onclick={() => onSelectChannel(channel)}
            >
              <span class="channel-glyph" aria-hidden="true"
                >{channel.type === 'voice'
                  ? '◖'
                  : channel.type === 'announcement'
                    ? '◉'
                    : '#'}</span
              >
              <span>{channel.name}</span>
              {#if channel.unreadCount}<b>{channel.unreadCount}</b>{/if}
            </button>
          {/each}
        </section>
      {/each}
    </div>
  {:else}
    <div class="empty-sidebar">
      <span>◇</span>
      <p>Select or create a community.</p>
    </div>
  {/if}

  <footer class="user-bar">
    <Avatar
      src={currentUser.avatarUrl}
      name={currentUser.displayName}
      status={currentUser.status}
      size={36}
    />
    <div class="user-copy">
      <strong>{currentUser.displayName}</strong><small>@{currentUser.username}</small>
    </div>
    <button
      class="icon-button"
      type="button"
      onclick={onOpenSettings}
      aria-label="Open settings"
      title="Settings">⚙</button
    >
  </footer>
</aside>

<style>
  .channel-sidebar {
    display: flex;
    min-width: 0;
    flex-direction: column;
    border-inline-end: 1px solid var(--line);
    background: var(--bg-sidebar);
  }
  .server-heading {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 16px;
    border-block-end: 1px solid var(--line);
  }
  .server-heading > div {
    min-width: 0;
    flex: 1;
  }
  .server-heading strong,
  .server-heading small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .server-heading strong {
    font-size: 0.9rem;
  }
  .server-heading small {
    color: var(--text-muted);
    font-size: 0.69rem;
  }
  .channel-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 14px 8px;
  }
  .channel-section {
    margin-block-end: 17px;
  }
  .section-heading {
    display: flex;
    align-items: center;
    padding: 0 8px 5px;
    color: var(--text-muted);
    font-size: 0.65rem;
    font-weight: 850;
    letter-spacing: 0.08em;
  }
  .section-heading span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .section-heading button {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
  }
  .section-heading button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .channel-link {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    gap: 8px;
    margin: 1px 0;
    padding: 0 9px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    text-align: start;
  }
  .channel-link > span:nth-child(2) {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .channel-link:hover {
    background: var(--bg-hover);
    color: var(--text-soft);
  }
  .channel-link.active {
    background: var(--brand-soft);
    color: #c4b5fd;
    font-weight: 700;
  }
  .channel-link b {
    min-width: 18px;
    border-radius: 9px;
    background: var(--red);
    color: white;
    font-size: 0.64rem;
    text-align: center;
  }
  .channel-glyph {
    width: 17px;
    color: currentColor;
    font-size: 1.04rem;
    text-align: center;
  }
  .user-bar {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 9px;
    padding: 8px;
    border-block-start: 1px solid var(--line);
    background: var(--bg-rail);
  }
  .user-copy {
    min-width: 0;
    flex: 1;
  }
  .user-copy strong,
  .user-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-copy strong {
    font-size: 0.78rem;
  }
  .user-copy small {
    color: var(--text-muted);
    font-size: 0.67rem;
  }
  .user-bar .icon-button {
    width: 34px;
    min-width: 34px;
    min-height: 34px;
  }
  .empty-sidebar {
    display: grid;
    flex: 1;
    padding: 24px;
    place-content: center;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-sidebar span {
    font-size: 2rem;
  }
</style>
