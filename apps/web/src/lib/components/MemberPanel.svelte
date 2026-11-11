<script lang="ts">
  import type { ServerMember } from '../client-types';
  import Avatar from './Avatar.svelte';

  let {
    members,
    loading,
    mobileOpen = false,
  }: { members: ServerMember[]; loading: boolean; mobileOpen?: boolean } = $props();

  const online = $derived(members.filter((member) => member.user.status !== 'offline'));
  const offline = $derived(members.filter((member) => member.user.status === 'offline'));
</script>

<aside class={`members-panel${mobileOpen ? ' mobile-open' : ''}`} aria-label="Community members">
  <div class="members-heading"><strong>Members</strong><span>{members.length}</span></div>
  <div class="member-scroll">
    {#if loading}
      {#each Array(8) as _}
        <div class="member-row">
          <div class="skeleton avatar-skeleton"></div>
          <div class="skeleton name-skeleton"></div>
        </div>
      {/each}
    {:else}
      <p class="group-label">ONLINE — {online.length}</p>
      {#each online as member (member.user.id)}
        <button class="member-row" type="button" title={`@${member.user.username}`}>
          <Avatar
            src={member.user.avatarUrl}
            name={member.user.displayName}
            status={member.user.status}
            size={34}
          />
          <span
            ><strong>{member.nickname ?? member.user.displayName}</strong><small
              >@{member.user.username}</small
            ></span
          >
        </button>
      {/each}
      {#if offline.length}
        <p class="group-label">OFFLINE — {offline.length}</p>
        {#each offline as member (member.user.id)}
          <button class="member-row offline" type="button" title={`@${member.user.username}`}>
            <Avatar src={member.user.avatarUrl} name={member.user.displayName} size={34} />
            <span
              ><strong>{member.nickname ?? member.user.displayName}</strong><small
                >@{member.user.username}</small
              ></span
            >
          </button>
        {/each}
      {/if}
    {/if}
  </div>
</aside>

<style>
  .members-panel {
    display: flex;
    min-width: 0;
    flex-direction: column;
    border-inline-start: 1px solid var(--line);
    background: var(--bg-sidebar);
  }
  .members-heading {
    display: flex;
    min-height: 58px;
    align-items: center;
    padding: 0 16px;
    border-block-end: 1px solid var(--line);
  }
  .members-heading strong {
    flex: 1;
    font-size: 0.82rem;
  }
  .members-heading span {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .member-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 12px 8px;
  }
  .group-label {
    margin: 12px 8px 5px;
    color: var(--text-muted);
    font-size: 0.62rem;
    font-weight: 850;
    letter-spacing: 0.08em;
  }
  .member-row {
    display: flex;
    width: 100%;
    min-height: 46px;
    align-items: center;
    gap: 10px;
    padding: 5px 8px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-soft);
    text-align: start;
  }
  .member-row:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .member-row > span {
    min-width: 0;
  }
  .member-row strong,
  .member-row small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member-row strong {
    font-size: 0.78rem;
  }
  .member-row small {
    color: var(--text-muted);
    font-size: 0.65rem;
  }
  .member-row.offline {
    opacity: 0.48;
  }
  .avatar-skeleton {
    width: 34px;
    height: 34px;
    border-radius: 50%;
  }
  .name-skeleton {
    width: 110px;
    height: 12px;
  }
  @media (max-width: 1100px) {
    .members-panel.mobile-open {
      position: fixed;
      z-index: 82;
      display: flex !important;
      width: min(82vw, 280px);
      box-shadow: var(--shadow);
      inset-block: 0 58px;
      inset-inline-end: 0;
    }
  }
</style>
