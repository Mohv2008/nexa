<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, updated, children }: { title: string; updated: string; children: Snippet } =
    $props();
</script>

<main class="legal-page">
  <nav><a href="/" aria-label="Back to NEXA"><span>N</span><strong>NEXA</strong></a></nav>
  <article>
    <p class="eyebrow">LEGAL</p>
    <h1>{title}</h1>
    <p class="updated">Last updated {updated}</p>
    {@render children()}
  </article>
</main>

<style>
  :global(html),
  :global(body) {
    overflow: auto;
  }
  .legal-page {
    min-height: 100dvh;
    background: var(--bg-deep);
  }
  nav {
    display: flex;
    height: 68px;
    align-items: center;
    padding: 0 max(20px, calc((100% - 760px) / 2));
    border-block-end: 1px solid var(--line);
    background: var(--bg-panel);
  }
  nav a {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--text);
    letter-spacing: 0.12em;
  }
  nav span {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 10px;
    background: var(--brand);
    color: white;
    font-weight: 900;
  }
  article {
    width: min(760px, calc(100% - 36px));
    margin: 0 auto;
    padding: 62px 0 100px;
  }
  h1 {
    margin: 0;
    font-size: clamp(2.2rem, 7vw, 4.5rem);
    letter-spacing: -0.055em;
  }
  .updated {
    margin: 8px 0 42px;
    color: var(--text-muted);
  }
  article :global(h2) {
    margin: 36px 0 8px;
    font-size: 1.2rem;
  }
  article :global(p),
  article :global(li) {
    color: var(--text-soft);
    line-height: 1.75;
  }
  article :global(code) {
    padding: 2px 5px;
    border-radius: 5px;
    background: var(--bg-raised);
  }
</style>
