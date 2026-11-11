<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ClientMessage } from '../client-types';
  import Avatar from './Avatar.svelte';
  import SmartImage from './SmartImage.svelte';

  let {
    messages,
    currentUserId,
    loading,
    hasOlder = false,
    onLoadOlder,
    onReact,
    onReply,
  }: {
    messages: ClientMessage[];
    currentUserId: string;
    loading: boolean;
    hasOlder?: boolean;
    onLoadOlder: () => void;
    onReact: (messageId: string, emoji: string, reacted: boolean) => void;
    onReply: (message: ClientMessage) => void;
  } = $props();

  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportHeight = $state(600);
  let pinnedToBottom = $state(true);
  let heights = $state<Record<string, number>>({});
  const estimate = 78;

  const metrics = $derived.by(() => {
    let top = 0;
    return messages.map((message, index) => {
      const height = heights[message.id] ?? estimate;
      const metric = { message, index, top, height };
      top += height;
      return metric;
    });
  });
  const totalHeight = $derived(metrics.at(-1) ? metrics.at(-1)!.top + metrics.at(-1)!.height : 0);
  const visible = $derived(
    metrics.filter(
      (metric) =>
        metric.top + metric.height >= scrollTop - 500 &&
        metric.top <= scrollTop + viewportHeight + 500,
    ),
  );

  function measure(node: HTMLElement, parameters: { id: string }) {
    const update = (): void => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height > 0 && heights[parameters.id] !== height) {
        heights = { ...heights, [parameters.id]: height };
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return { destroy: () => observer.disconnect() };
  }

  function onScroll(): void {
    scrollTop = viewport.scrollTop;
    viewportHeight = viewport.clientHeight;
    pinnedToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
  }

  async function scrollBottom(behavior: ScrollBehavior = 'auto'): Promise<void> {
    await tick();
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior });
  }

  $effect(() => {
    const lastId = messages.at(-1)?.id;
    if (lastId && pinnedToBottom) void scrollBottom('smooth');
  });

  onMount(() => {
    const observer = new ResizeObserver(() => {
      viewportHeight = viewport.clientHeight;
    });
    observer.observe(viewport);
    void scrollBottom();
    return () => observer.disconnect();
  });

  function messageTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(value),
    );
  }
</script>

<div
  class="message-viewport"
  bind:this={viewport}
  onscroll={onScroll}
  aria-live="polite"
  aria-label="Messages"
>
  {#if hasOlder}
    <button
      class="load-older secondary-button"
      type="button"
      onclick={onLoadOlder}
      disabled={loading}
    >
      {loading ? 'Loading…' : 'Load older messages'}
    </button>
  {/if}
  {#if loading && messages.length === 0}
    <div class="message-loading" aria-label="Loading messages">
      {#each Array(7) as _, index}
        <div class="message-skeleton" style:width={`${58 + (index % 3) * 11}%`}>
          <i class="skeleton"></i><span class="skeleton"></span>
        </div>
      {/each}
    </div>
  {:else if messages.length === 0}
    <div class="empty-state">
      <div class="empty-icon">✦</div>
      <strong>Start the conversation</strong>
      <p>There are no messages here yet.</p>
    </div>
  {:else}
    <div class="virtual-space" style:height={`${totalHeight}px`}>
      {#each visible as metric (metric.message.id)}
        {@const message = metric.message}
        <article
          class:deleted={Boolean(message.deletedAt)}
          class:own={message.author.id === currentUserId}
          class="message-row"
          style:transform={`translateY(${metric.top}px)`}
          use:measure={{ id: message.id }}
        >
          <Avatar
            src={message.author.avatarUrl}
            name={message.author.displayName}
            status={message.author.status}
            size={38}
          />
          <div class="message-content">
            <div class="message-meta">
              <strong>{message.author.displayName}</strong>
              <small>@{message.author.username}</small>
              <time datetime={message.createdAt}>{messageTime(message.createdAt)}</time>
              {#if message.editedAt}<em>(edited)</em>{/if}
            </div>
            {#if message.deletedAt}
              <p class="deleted-copy">Message deleted</p>
            {:else}
              {#if message.forwardedFrom}<span class="forwarded">↪ Forwarded</span>{/if}
              {#if message.replyTo}<span class="reply-marker">↳ Replying to a message</span>{/if}
              {#if message.content}<p class="message-text">{message.content}</p>{/if}
              {#if message.attachments.length}
                <div class="attachments">
                  {#each message.attachments as attachment (attachment.id)}
                    {#if attachment.mime.startsWith('image/')}
                      <SmartImage
                        src={attachment.url}
                        alt={attachment.name}
                        class="image-attachment"
                      />
                    {:else if attachment.mime.startsWith('audio/')}
                      <audio controls preload="none" src={attachment.url}
                        ><track kind="captions" /></audio
                      >
                    {:else}
                      <a class="file-attachment" href={attachment.url} download={attachment.name}
                        >⬇ <span
                          >{attachment.name}<small>{Math.ceil(attachment.size / 1024)} KB</small
                          ></span
                        ></a
                      >
                    {/if}
                  {/each}
                </div>
              {/if}
              {#if message.reactions.length}
                <div class="reactions" aria-label="Message reactions">
                  {#each message.reactions as reaction (reaction.emoji)}
                    <button
                      class:reacted={reaction.reacted}
                      type="button"
                      onclick={() => onReact(message.id, reaction.emoji, reaction.reacted)}
                      aria-label={`${reaction.emoji}, ${reaction.count} reactions`}
                      >{reaction.emoji} <span>{reaction.count}</span></button
                    >
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
          {#if !message.deletedAt}
            <div class="message-actions">
              <button
                type="button"
                onclick={() => onReact(message.id, '👍', false)}
                aria-label="React with thumbs up">👍</button
              >
              <button type="button" onclick={() => onReply(message)} aria-label="Reply">↩</button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .message-viewport {
    position: relative;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    overflow-anchor: none;
  }
  .virtual-space {
    position: relative;
    min-height: 100%;
  }
  .message-row {
    position: absolute;
    display: flex;
    width: 100%;
    min-height: 66px;
    gap: 11px;
    padding: 8px 54px 8px 18px;
    inset: 0 0 auto;
  }
  :global([dir='rtl']) .message-row {
    padding: 8px 18px 8px 54px;
  }
  .message-row:hover {
    background: rgb(255 255 255 / 2.5%);
  }
  :global([data-theme='light']) .message-row:hover {
    background: rgb(0 0 0 / 2%);
  }
  .message-content {
    min-width: 0;
    flex: 1;
  }
  .message-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-height: 20px;
  }
  .message-meta strong {
    font-size: 0.83rem;
    color: var(--text);
  }
  .message-meta small,
  .message-meta time,
  .message-meta em {
    color: var(--text-muted);
    font-size: 0.65rem;
    font-style: normal;
  }
  .message-text {
    margin: 2px 0;
    overflow-wrap: anywhere;
    color: var(--text-soft);
    font-size: 0.88rem;
    white-space: pre-wrap;
  }
  .deleted-copy {
    margin: 3px 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
  }
  .forwarded,
  .reply-marker {
    display: block;
    color: var(--text-muted);
    font-size: 0.64rem;
  }
  .attachments {
    display: flex;
    max-width: 520px;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 7px;
  }
  :global(.image-attachment) {
    display: block;
    max-width: min(360px, 100%);
    overflow: hidden;
    border-radius: 10px;
    background: var(--bg-deep);
  }
  :global(.image-attachment img) {
    display: block;
    max-height: 320px;
    object-fit: contain;
  }
  audio {
    width: min(360px, 70vw);
    height: 38px;
  }
  .file-attachment {
    display: flex;
    min-width: 220px;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-raised);
    color: var(--text-soft);
  }
  .file-attachment span,
  .file-attachment small {
    display: block;
  }
  .file-attachment small {
    color: var(--text-muted);
  }
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }
  .reactions button {
    min-height: 27px;
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    color: var(--text-soft);
    font-size: 0.75rem;
  }
  .reactions button.reacted {
    border-color: var(--brand);
    background: var(--brand-soft);
    color: #c4b5fd;
  }
  .message-actions {
    position: absolute;
    display: none;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    box-shadow: 0 5px 16px rgb(0 0 0 / 18%);
    inset-inline-end: 12px;
    inset-block-start: -9px;
  }
  .message-row:hover .message-actions,
  .message-row:focus-within .message-actions {
    display: flex;
  }
  .message-actions button {
    width: 34px;
    height: 30px;
    background: transparent;
    color: var(--text-soft);
  }
  .message-actions button:hover {
    background: var(--bg-hover);
  }
  .load-older {
    position: sticky;
    z-index: 2;
    display: block;
    min-height: 32px;
    margin: 9px auto;
    inset-block-start: 8px;
    font-size: 0.72rem;
  }
  .message-loading {
    display: grid;
    gap: 18px;
    padding: 24px 18px;
  }
  .message-skeleton {
    display: grid;
    grid-template-columns: 38px 1fr;
    gap: 11px;
  }
  .message-skeleton i {
    width: 38px;
    height: 38px;
    border-radius: 50%;
  }
  .message-skeleton span {
    height: 30px;
  }
  @media (max-width: 600px) {
    .message-row {
      padding-inline: 12px 44px;
    }
  }
</style>
