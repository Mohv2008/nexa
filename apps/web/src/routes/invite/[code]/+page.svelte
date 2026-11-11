<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, bootstrapSession } from '../../../lib/api';

  let status = $state('Checking your invitation…');
  let joined = $state(false);
  let needsLogin = $state(false);

  onMount(async () => {
    const code = page.params.code ?? '';
    if (!code) {
      status = 'This invitation link is incomplete.';
      return;
    }
    localStorage.setItem('nexa.pendingInvite', code);
    if (!(await bootstrapSession())) {
      needsLogin = true;
      status = 'Sign in or create an account to accept this invitation.';
      return;
    }
    try {
      await api(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST', body: '{}' });
      localStorage.removeItem('nexa.pendingInvite');
      joined = true;
      status = 'Invitation accepted.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'This invitation is invalid.';
    }
  });
</script>

<svelte:head><title>Community invitation · NEXA</title></svelte:head>
<main>
  <div class="invite-icon">◈</div>
  <p class="eyebrow">NEXA INVITATION</p>
  <h1>{status}</h1>
  <p>{joined ? 'Welcome to the community.' : 'Invites may expire or reach their usage limit.'}</p>
  <a class="primary-button" href="/app">{needsLogin ? 'Continue to sign in' : 'Open NEXA'}</a>
</main>

<style>
  main {
    display: grid;
    min-height: 100dvh;
    place-content: center;
    justify-items: center;
    padding: 24px;
    background:
      radial-gradient(circle at 50% 30%, rgb(139 92 246 / 18%), transparent 40%), var(--bg-deep);
    text-align: center;
  }
  .invite-icon {
    display: grid;
    width: 78px;
    height: 78px;
    margin-bottom: 22px;
    place-items: center;
    border-radius: 24px;
    background: var(--brand);
    color: white;
    font-size: 2rem;
  }
  h1 {
    max-width: 620px;
    margin: 0;
    font-size: clamp(1.6rem, 5vw, 2.5rem);
  }
  main > p:not(.eyebrow) {
    color: var(--text-muted);
  }
  a {
    display: inline-grid;
    align-items: center;
    margin-top: 12px;
  }
</style>
