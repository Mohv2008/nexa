<script lang="ts">
  import type { ServerSummary } from '../client-types';
  import { preferences } from '../preferences';

  let {
    servers,
    selectedServerId,
    activeView,
    mobileOpen = false,
    onSelect,
    onNavigate,
    onCreate,
  }: {
    servers: ServerSummary[];
    selectedServerId: string | null;
    activeView: string;
    mobileOpen?: boolean;
    onSelect: (id: string) => void;
    onNavigate: (view: string) => void;
    onCreate: () => void;
  } = $props();
</script>

<nav class={`server-rail${mobileOpen ? ' mobile-open' : ''}`} aria-label="Main navigation">
  <button
    class:active={activeView === 'feed'}
    class="rail-button home"
    type="button"
    onclick={() => onNavigate('feed')}
    aria-label="Home feed"
    title="Home feed">N</button
  >
  <div class="rail-separator"></div>
  <div class="server-stack">
    {#each servers as server (server.id)}
      <button
        class:active={activeView === 'community' && server.id === selectedServerId}
        class="server-button"
        type="button"
        onclick={() => onSelect(server.id)}
        aria-label={server.name}
        title={server.name}
      >
        {#if server.iconUrl && !$preferences.lowPower}
          <img src={server.iconUrl} alt="" loading="lazy" />
        {:else}
          <span>{server.name.slice(0, 2).toUpperCase()}</span>
        {/if}
      </button>
    {/each}
    <button
      class="server-button add"
      type="button"
      onclick={onCreate}
      aria-label="Create community"
      title="Create community">＋</button
    >
  </div>
  <div class="rail-spacer"></div>
  <button
    class:active={activeView === 'messages'}
    class="rail-button"
    type="button"
    onclick={() => onNavigate('messages')}
    aria-label="Direct messages"
    title="Direct messages">✉</button
  >
  <button
    class:active={activeView === 'notifications'}
    class="rail-button"
    type="button"
    onclick={() => onNavigate('notifications')}
    aria-label="Notifications"
    title="Notifications">♢</button
  >
  <button
    class:active={activeView === 'settings'}
    class="rail-button"
    type="button"
    onclick={() => onNavigate('settings')}
    aria-label="Settings"
    title="Settings">⚙</button
  >
</nav>

<style>
  .server-rail {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    overflow: hidden;
    border-inline-end: 1px solid var(--line);
    background: var(--bg-rail);
  }
  .server-stack {
    display: flex;
    width: 100%;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .server-stack::-webkit-scrollbar {
    display: none;
  }
  .rail-button,
  .server-button {
    position: relative;
    display: grid;
    width: 48px;
    height: 48px;
    flex: 0 0 auto;
    place-items: center;
    overflow: hidden;
    border-radius: 16px;
    background: var(--bg-raised);
    color: var(--text-soft);
    font-weight: 800;
    transition:
      border-radius 160ms,
      background 160ms,
      color 160ms;
  }
  .rail-button:hover,
  .server-button:hover,
  .rail-button.active,
  .server-button.active {
    border-radius: 13px;
    background: var(--brand);
    color: white;
  }
  .rail-button.active::before,
  .server-button.active::before {
    position: absolute;
    width: 4px;
    height: 28px;
    border-radius: 0 4px 4px 0;
    background: var(--text);
    content: '';
    inset-inline-start: -9px;
  }
  :global([dir='rtl']) .rail-button.active::before,
  :global([dir='rtl']) .server-button.active::before {
    border-radius: 4px 0 0 4px;
  }
  .home {
    background: linear-gradient(135deg, #8b5cf6, #6d28d9);
    color: white;
    font-size: 1.15rem;
  }
  .server-button img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .server-button span {
    font-size: 0.78rem;
  }
  .server-button.add {
    border: 1px dashed #4b5563;
    background: transparent;
    color: var(--green);
    font-size: 1.35rem;
  }
  .server-button.add:hover {
    border-color: var(--green);
    background: rgb(52 211 153 / 12%);
  }
  .rail-separator {
    width: 32px;
    height: 1px;
    background: var(--line);
  }
  .rail-spacer {
    flex: 1;
  }
</style>
