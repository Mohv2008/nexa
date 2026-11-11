<script lang="ts">
  import { preferences } from '../preferences';

  let {
    src = null,
    name,
    size = 40,
    status = null,
  }: {
    src?: string | null;
    name: string;
    size?: number;
    status?: string | null;
  } = $props();

  const initials = $derived(
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?',
  );
</script>

<span class="avatar" style:width={`${size}px`} style:height={`${size}px`} aria-label={name}>
  {#if src && !$preferences.lowPower}
    <img {src} alt="" width={size} height={size} loading="lazy" decoding="async" />
  {:else}
    <span aria-hidden="true">{initials}</span>
  {/if}
  {#if status}
    <span class="status-dot {status}" aria-label={status}></span>
  {/if}
</span>
