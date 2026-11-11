<script lang="ts">
  import { preferences } from '../preferences';

  let { src, alt, class: className = '' }: { src: string; alt: string; class?: string } = $props();
  let approved = $state(false);

  function approve(): void {
    approved = true;
  }
</script>

{#if !$preferences.lowPower || approved}
  <a href={src} target="_blank" rel="noreferrer" class={`smart-image-link ${className}`}>
    <img {src} {alt} loading="lazy" decoding="async" />
  </a>
{:else}
  <button
    type="button"
    class={`low-power-image ${className}`}
    onclick={() => approve()}
    aria-label={`Load image: ${alt}`}>▧ <small>Load image</small></button
  >
{/if}

<style>
  .smart-image-link,
  .smart-image-link img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .low-power-image {
    display: grid;
    min-width: 150px;
    min-height: 100px;
    place-content: center;
    justify-items: center;
    border: 1px dashed var(--line);
    border-radius: 9px;
    background: var(--bg-deep);
    color: var(--text-muted);
    cursor: pointer;
  }
  .low-power-image small {
    display: block;
    font-size: 0.65rem;
  }
</style>
