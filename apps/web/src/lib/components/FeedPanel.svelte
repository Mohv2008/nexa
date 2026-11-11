<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { Account, ApiData, Post } from '../client-types';
  import { uploadFile } from '../image';
  import Avatar from './Avatar.svelte';
  import SmartImage from './SmartImage.svelte';

  let {
    currentUser,
    onToggleNavigation,
    notify,
  }: {
    currentUser: Account;
    onToggleNavigation: () => void;
    notify: (message: string, error?: boolean) => void;
  } = $props();

  let posts = $state<Post[]>([]);
  let loading = $state(true);
  let loadingMore = $state(false);
  let cursor = $state<string | null>(null);
  let body = $state('');
  let visibility = $state<'public' | 'followers' | 'friends'>('public');
  let mediaKeys = $state<string[]>([]);
  let mediaNames = $state<string[]>([]);
  let publishing = $state(false);
  let uploading = $state(false);
  let expandedComments = $state<string | null>(null);
  let comments = $state<Record<string, Array<Record<string, unknown>>>>({});
  let commentBody = $state('');
  let fileInput = $state<HTMLInputElement>();

  async function loadFeed(append = false): Promise<void> {
    if (append) loadingMore = true;
    else loading = true;
    try {
      const query = append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await api<ApiData<{ items: Post[]; nextCursor: string | null }>>(
        `/feed${query}`,
      );
      posts = append ? [...posts, ...response.data.items] : response.data.items;
      cursor = response.data.nextCursor;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load the feed.', true);
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function addMedia(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    uploading = true;
    try {
      for (const file of [...files].slice(0, 4 - mediaKeys.length)) {
        const uploaded = await uploadFile(file);
        mediaKeys = [...mediaKeys, uploaded.key];
        mediaNames = [...mediaNames, uploaded.name];
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Upload failed.', true);
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async function publish(): Promise<void> {
    if (!body.trim() || publishing) return;
    publishing = true;
    try {
      const response = await api<ApiData<Post>>('/posts', {
        method: 'POST',
        body: JSON.stringify({ body, visibility, mediaKeys }),
      });
      posts = [response.data, ...posts];
      body = '';
      mediaKeys = [];
      mediaNames = [];
      notify('Post published.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not publish.', true);
    } finally {
      publishing = false;
    }
  }

  async function toggleLike(post: Post): Promise<void> {
    const liked = post.liked;
    posts = posts.map((item) =>
      item.id === post.id
        ? { ...item, liked: !liked, likeCount: item.likeCount + (liked ? -1 : 1) }
        : item,
    );
    try {
      await api(`/posts/${post.id}/likes`, { method: liked ? 'DELETE' : 'POST' });
    } catch (error) {
      posts = posts.map((item) =>
        item.id === post.id
          ? { ...item, liked, likeCount: item.likeCount + (liked ? 1 : -1) }
          : item,
      );
      notify(error instanceof Error ? error.message : 'Could not update like.', true);
    }
  }

  async function openComments(postId: string): Promise<void> {
    expandedComments = expandedComments === postId ? null : postId;
    if (expandedComments && !comments[postId]) {
      const response = await api<ApiData<{ items: Array<Record<string, unknown>> }>>(
        `/posts/${postId}/comments`,
      );
      comments = { ...comments, [postId]: response.data.items };
    }
  }

  async function addComment(postId: string): Promise<void> {
    if (!commentBody.trim()) return;
    const response = await api<ApiData<{ id: string }>>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    });
    comments = {
      ...comments,
      [postId]: [
        ...(comments[postId] ?? []),
        {
          id: response.data.id,
          body: commentBody,
          author: currentUser,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    posts = posts.map((post) =>
      post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post,
    );
    commentBody = '';
  }

  async function share(post: Post): Promise<void> {
    await api(`/posts/${post.id}/share`, { method: 'POST' });
    posts = posts.map((item) =>
      item.id === post.id ? { ...item, shareCount: item.shareCount + 1 } : item,
    );
    const url = `${location.origin}/post/${post.id}`;
    if (navigator.share) await navigator.share({ title: 'NEXA post', text: post.body, url });
    else {
      await navigator.clipboard.writeText(url);
      notify('Post link copied.');
    }
  }

  function relativeTime(value: string): string {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    return formatter.format(Math.round(hours / 24), 'day');
  }

  onMount(() => void loadFeed());
</script>

<main class="feed-panel">
  <header class="panel-header">
    <button
      class="icon-button mobile-only"
      type="button"
      onclick={onToggleNavigation}
      aria-label="Open navigation">☰</button
    >
    <div>
      <h1>Your feed</h1>
      <small>Updates from people you follow</small>
    </div>
  </header>
  <div class="feed-scroll">
    <section class="composer-card" aria-label="Create a post">
      <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size={40} />
      <div class="post-compose">
        <textarea
          bind:value={body}
          maxlength="5000"
          rows="2"
          placeholder={`What's happening, ${currentUser.displayName}?`}
          aria-label="Post text"></textarea>
        {#if mediaNames.length}
          <div class="media-chips">
            {#each mediaNames as name, index}<span
                >▧ {name}<button
                  type="button"
                  onclick={() => {
                    mediaNames = mediaNames.filter((_, i) => i !== index);
                    mediaKeys = mediaKeys.filter((_, i) => i !== index);
                  }}>✕</button
                ></span
              >{/each}
          </div>
        {/if}
        <div class="compose-actions">
          <input
            bind:this={fileInput}
            class="sr-only"
            type="file"
            accept="image/*"
            multiple
            onchange={(event) => void addMedia(event.currentTarget.files)}
          />
          <button
            class="ghost-button"
            type="button"
            onclick={() => fileInput?.click()}
            disabled={uploading || mediaKeys.length >= 4}
            >▧ {uploading ? 'Uploading…' : 'Photo'}</button
          >
          <select bind:value={visibility} aria-label="Post visibility"
            ><option value="public">Public</option><option value="followers">Followers</option
            ><option value="friends">Friends</option></select
          >
          <span></span>
          <small>{body.length}/5000</small>
          <button
            class="primary-button"
            type="button"
            onclick={() => void publish()}
            disabled={!body.trim() || publishing}>{publishing ? 'Posting…' : 'Post'}</button
          >
        </div>
      </div>
    </section>

    {#if loading}
      {#each Array(4) as _}<div class="post-card loading-card">
          <div class="skeleton post-avatar"></div>
          <div class="skeleton post-lines"></div>
        </div>{/each}
    {:else if posts.length === 0}
      <div class="empty-state">
        <div class="empty-icon">⌁</div>
        <strong>Your feed is quiet</strong>
        <p>Follow people or join public communities to discover more.</p>
      </div>
    {:else}
      {#each posts as post (post.id)}
        <article class="post-card">
          <Avatar
            src={post.author.avatarUrl}
            name={post.author.displayName}
            status={post.author.status}
            size={42}
          />
          <div class="post-main">
            <div class="post-meta">
              <strong>{post.author.displayName}</strong><span>@{post.author.username}</span><b>·</b
              ><time datetime={post.createdAt}>{relativeTime(post.createdAt)}</time>
            </div>
            <p class="post-body">{post.body}</p>
            {#if post.media.length}
              <div class:multi={post.media.length > 1} class="post-media">
                {#each post.media as media (media.id)}
                  {#if media.mime.startsWith('image/')}<SmartImage
                      src={media.url}
                      alt={media.name}
                    />{/if}
                {/each}
              </div>
            {/if}
            <div class="post-actions">
              <button
                class:active={post.liked}
                type="button"
                onclick={() => void toggleLike(post)}
                aria-label="Like post"
                >{post.liked ? '♥' : '♡'} <span>{post.likeCount}</span></button
              >
              <button type="button" onclick={() => void openComments(post.id)} aria-label="Comments"
                >◌ <span>{post.commentCount}</span></button
              >
              <button type="button" onclick={() => void share(post)} aria-label="Share post"
                >↗ <span>{post.shareCount}</span></button
              >
            </div>
            {#if expandedComments === post.id}
              <div class="comments">
                {#each comments[post.id] ?? [] as comment (String(comment.id))}
                  {@const author = comment.author as Account}
                  <div class="comment">
                    <Avatar src={author.avatarUrl} name={author.displayName} size={28} />
                    <p><strong>{author.displayName}</strong> {String(comment.body)}</p>
                  </div>
                {/each}
                <div class="comment-compose">
                  <input
                    bind:value={commentBody}
                    maxlength="2000"
                    placeholder="Write a comment…"
                    onkeydown={(event) => event.key === 'Enter' && void addComment(post.id)}
                  /><button type="button" onclick={() => void addComment(post.id)}>Send</button>
                </div>
              </div>
            {/if}
          </div>
        </article>
      {/each}
      {#if cursor}<button
          class="secondary-button load-more"
          type="button"
          onclick={() => void loadFeed(true)}
          disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button
        >{/if}
    {/if}
  </div>
</main>

<style>
  .feed-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    grid-column: 2 / -1;
    background: var(--bg-deep);
  }
  .panel-header > div small {
    color: var(--text-muted);
    font-size: 0.67rem;
  }
  .feed-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 22px max(16px, calc((100% - 680px) / 2)) 50px;
  }
  .composer-card,
  .post-card {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 15px;
    background: var(--bg-panel);
  }
  .post-compose,
  .post-main {
    min-width: 0;
    flex: 1;
  }
  .post-compose textarea {
    width: 100%;
    resize: vertical;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 1rem;
  }
  .compose-actions {
    display: grid;
    grid-template-columns: auto auto 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding-top: 9px;
    border-top: 1px solid var(--line);
  }
  .compose-actions select {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .compose-actions small {
    color: var(--text-muted);
    font-size: 0.67rem;
  }
  .compose-actions .primary-button {
    min-height: 34px;
  }
  .media-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: 7px 0;
  }
  .media-chips span {
    padding: 4px 7px;
    border-radius: 6px;
    background: var(--bg-raised);
    color: var(--text-muted);
    font-size: 0.67rem;
  }
  .media-chips button {
    background: transparent;
    color: inherit;
  }
  .post-card {
    content-visibility: auto;
    contain-intrinsic-size: auto 240px;
  }
  .post-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 5px;
  }
  .post-meta strong {
    font-size: 0.86rem;
  }
  .post-meta span,
  .post-meta time,
  .post-meta b {
    color: var(--text-muted);
    font-size: 0.68rem;
    font-weight: 400;
  }
  .post-body {
    margin: 7px 0 10px;
    overflow-wrap: anywhere;
    color: var(--text-soft);
    white-space: pre-wrap;
  }
  .post-media {
    display: grid;
    max-height: 520px;
    overflow: hidden;
    border-radius: 12px;
    background: var(--bg-deep);
  }
  .post-media.multi {
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .post-media :global(a) {
    min-height: 0;
  }
  .post-media :global(img) {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 520px;
    object-fit: cover;
  }
  .post-actions {
    display: flex;
    max-width: 360px;
    justify-content: space-between;
    margin-top: 9px;
  }
  .post-actions button {
    min-width: 66px;
    min-height: 34px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
  }
  .post-actions button:hover {
    background: var(--bg-hover);
    color: var(--text-soft);
  }
  .post-actions button.active {
    color: var(--red);
  }
  .comments {
    display: grid;
    gap: 7px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .comment {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .comment p {
    margin: 0;
    padding: 7px 9px;
    border-radius: 10px;
    background: var(--bg-raised);
    color: var(--text-soft);
    font-size: 0.76rem;
  }
  .comment p strong {
    color: var(--text);
  }
  .comment-compose {
    display: flex;
    gap: 6px;
  }
  .comment-compose input {
    min-width: 0;
    flex: 1;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--bg-input);
    color: var(--text);
    padding: 7px 9px;
  }
  .comment-compose button {
    border-radius: 8px;
    background: var(--brand);
    color: white;
    padding: 0 12px;
  }
  .loading-card {
    min-height: 120px;
  }
  .post-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
  }
  .post-lines {
    width: 70%;
    height: 68px;
  }
  .load-more {
    display: block;
    margin: 18px auto;
  }
  @media (max-width: 720px) {
    .feed-panel {
      height: calc(100dvh - 58px);
    }
    .feed-scroll {
      padding: 9px 7px 30px;
    }
    .composer-card,
    .post-card {
      border-radius: 11px;
      padding: 12px;
    }
  }
</style>
