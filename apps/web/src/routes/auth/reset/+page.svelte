<script lang="ts">
  import { api } from '../../../lib/api';

  let password = $state('');
  let confirmPassword = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function reset(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (password !== confirmPassword) {
      error = 'Passwords do not match.';
      return;
    }
    const token = new URL(location.href).searchParams.get('token');
    if (!token) {
      error = 'This reset link is incomplete.';
      return;
    }
    busy = true;
    error = '';
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
        retryAuth: false,
      });
      done = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Password reset failed.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Reset password · NEXA</title></svelte:head>
<main class="reset-page">
  <section>
    <a class="brand" href="/">N <strong>NEXA</strong></a>{#if done}<h1>Password updated</h1>
      <p>You can now sign in with your new password.</p>
      <a class="primary-button open" href="/app">Open NEXA</a>{:else}<h1>Choose a new password</h1>
      <p>Use 12 or more characters with uppercase, lowercase, and a number.</p>
      {#if error}<div class="error-banner" role="alert">{error}</div>{/if}
      <form onsubmit={reset}>
        <div class="field">
          <label for="new-password">New password</label><input
            id="new-password"
            type="password"
            minlength="12"
            maxlength="128"
            bind:value={password}
            required
          />
        </div>
        <div class="field">
          <label for="confirm-password">Confirm password</label><input
            id="confirm-password"
            type="password"
            minlength="12"
            maxlength="128"
            bind:value={confirmPassword}
            required
          />
        </div>
        <button class="primary-button" type="submit" disabled={busy}
          >{busy ? 'Updating…' : 'Update password'}</button
        >
      </form>{/if}
  </section>
</main>

<style>
  .reset-page {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    padding: 20px;
    background: var(--bg-deep);
  }
  section {
    width: min(420px, 100%);
    padding: 26px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-panel);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #a78bfa;
    letter-spacing: 0.1em;
  }
  h1 {
    margin: 28px 0 5px;
  }
  p {
    color: var(--text-muted);
  }
  form {
    display: grid;
    gap: 15px;
    margin-top: 20px;
  }
  form button {
    margin-top: 6px;
  }
  .open {
    display: inline-grid;
    align-items: center;
  }
</style>
