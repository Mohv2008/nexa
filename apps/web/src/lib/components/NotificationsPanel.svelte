<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { ApiData, AppNotification } from '../client-types';
  import Avatar from './Avatar.svelte';

  let {
    onToggleNavigation,
    notify,
  }: {
    onToggleNavigation: () => void;
    notify: (message: string, error?: boolean) => void;
  } = $props();

  let items = $state<AppNotification[]>([]);
  let loading = $state(true);

  const labels: Record<string, string> = {
    post_like: 'liked your post',
    post_share: 'shared your post',
    post_comment: 'commented on your post',
    comment_like: 'liked your comment',
    new_follower: 'started following you',
    friend_request: 'sent you a friend request',
    friend_accepted: 'accepted your friend request',
    direct_message: 'sent you a message',
    message_reaction: 'reacted to your message',
    message_mention: 'mentioned you in a message',
    post_mention: 'mentioned you in a post',
    conversation_added: 'added you to a conversation',
  };

  async function load(): Promise<void> {
    loading = true;
    try {
      const response = await api<ApiData<AppNotification[]>>('/notifications');
      items = response.data;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load notifications.', true);
    } finally {
      loading = false;
    }
  }

  async function markAllRead(): Promise<void> {
    await api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [] }) });
    items = items.map((item) => ({ ...item, read: true }));
  }

  function relative(value: string): string {
    const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60)
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(minutes, 'minute');
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
      new Date(value),
    );
  }

  onMount(() => void load());
</script>

<main class="notifications-panel">
  <header class="panel-header">
    <button
      class="icon-button mobile-only"
      type="button"
      onclick={onToggleNavigation}
      aria-label="Open navigation">☰</button
    >
    <h1>Notifications</h1>
    <div class="header-spacer"></div>
    <button class="ghost-button" type="button" onclick={() => void markAllRead()}
      >Mark all read</button
    >
  </header>
  <div class="notification-scroll">
    <section class="notification-card">
      {#if loading}
        {#each Array(8) as _}<div class="notification-row">
            <i class="skeleton"></i><span class="skeleton"></span>
          </div>{/each}
      {:else if items.length === 0}
        <div class="empty-state">
          <div class="empty-icon">♢</div>
          <strong>You're all caught up</strong>
          <p>New activity will show up here.</p>
        </div>
      {:else}
        {#each items as item (item.id)}
          <button class:unread={!item.read} class="notification-row" type="button">
            <Avatar
              src={item.actor?.avatarUrl}
              name={item.actor?.displayName ?? 'NEXA'}
              size={40}
            />
            <span
              ><strong>{item.actor?.displayName ?? 'NEXA'}</strong>
              {labels[item.type] ?? 'sent a notification'}<small>{relative(item.createdAt)}</small
              ></span
            >
            {#if !item.read}<i class="unread-dot" aria-label="Unread"></i>{/if}
          </button>
        {/each}
      {/if}
    </section>
  </div>
</main>

<style>
  .notifications-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    grid-column: 2 / -1;
    background: var(--bg-deep);
  }
  .notification-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 22px max(14px, calc((100% - 680px) / 2));
  }
  .notification-card {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 15px;
    background: var(--bg-panel);
  }
  .notification-row {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 68px;
    align-items: center;
    gap: 11px;
    padding: 11px 15px;
    border-block-end: 1px solid var(--line);
    background: transparent;
    color: var(--text-soft);
    text-align: start;
  }
  .notification-row:last-child {
    border: 0;
  }
  .notification-row:hover {
    background: var(--bg-hover);
  }
  .notification-row.unread {
    background: var(--brand-soft);
  }
  .notification-row > span {
    min-width: 0;
    flex: 1;
    font-size: 0.82rem;
  }
  .notification-row strong {
    color: var(--text);
  }
  .notification-row small {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 0.66rem;
  }
  .notification-row > i.skeleton {
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    border-radius: 50%;
  }
  .notification-row > span.skeleton {
    height: 28px;
  }
  .unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--brand);
  }
  @media (max-width: 720px) {
    .notifications-panel {
      height: calc(100dvh - 58px);
    }
    .notification-scroll {
      padding: 8px;
    }
  }
</style>
