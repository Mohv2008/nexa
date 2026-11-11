<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    onClose,
    children,
    actions,
  }: {
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={keydown} />

<div
  class="modal-backdrop"
  role="presentation"
  onclick={(event) => event.target === event.currentTarget && onClose()}
>
  <div class="modal-card" role="dialog" aria-modal="true" aria-label={title}>
    <header class="modal-title">
      <h2>{title}</h2>
      <button class="icon-button" type="button" onclick={onClose} aria-label="Close dialog"
        >✕</button
      >
    </header>
    <div class="modal-body">{@render children()}</div>
    {#if actions}
      <footer class="modal-actions">{@render actions()}</footer>
    {/if}
  </div>
</div>
