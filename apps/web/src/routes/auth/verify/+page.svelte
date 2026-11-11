<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../../lib/api';

  let phase = $state<'working' | 'done' | 'error'>('working');
  let message = $state('Verifying your email…');

  onMount(async () => {
    const token = new URL(location.href).searchParams.get('token');
    if (!token) {
      phase = 'error';
      message = 'This verification link is incomplete.';
      return;
    }
    try {
      await api('/auth/email/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
        retryAuth: false,
      });
      phase = 'done';
      message = 'Your email is verified.';
    } catch (error) {
      phase = 'error';
      message = error instanceof Error ? error.message : 'Verification failed.';
    }
  });
</script>

<svelte:head><title>Verify email · NEXA</title></svelte:head>
<main class="auth-action">
  <div class:success={phase === 'done'} class:error={phase === 'error'} class="action-icon">
    {phase === 'working' ? '…' : phase === 'done' ? '✓' : '!'}
  </div>
  <h1>{message}</h1>
  <p>
    {phase === 'done'
      ? 'You can return to NEXA.'
      : 'Request a new link from account settings if needed.'}
  </p>
  <a class="primary-button" href="/app">Open NEXA</a>
</main>

<style>
  .auth-action {
    display: grid;
    min-height: 100dvh;
    place-content: center;
    justify-items: center;
    padding: 24px;
    background: var(--bg-deep);
    text-align: center;
  }
  .action-icon {
    display: grid;
    width: 66px;
    height: 66px;
    place-items: center;
    border-radius: 20px;
    background: var(--brand-soft);
    color: #a78bfa;
    font-size: 1.7rem;
  }
  .action-icon.success {
    background: rgb(52 211 153 / 14%);
    color: var(--green);
  }
  .action-icon.error {
    background: rgb(251 113 133 / 14%);
    color: var(--red);
  }
  h1 {
    margin: 20px 0 6px;
    font-size: 1.7rem;
  }
  p {
    margin: 0 0 22px;
    color: var(--text-muted);
  }
  a {
    display: inline-grid;
    align-items: center;
  }
</style>
