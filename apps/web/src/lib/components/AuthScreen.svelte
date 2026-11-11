<script lang="ts">
  import { APP_NAME } from '@nexa/shared';
  import { api, ApiError, setCsrfToken } from '../api';
  import type { Account, ApiData } from '../client-types';

  let { onAuthenticated }: { onAuthenticated: (account: Account) => void } = $props();

  let mode = $state<'login' | 'register'>('login');
  let busy = $state(false);
  let error = $state('');
  let needsTotp = $state(false);
  let email = $state('');
  let identifier = $state('');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let birthDate = $state('');
  let totp = $state('');
  let acceptTerms = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { identifier, password, ...(totp ? { totp } : {}) }
          : { email, username, displayName, password, birthDate, acceptTerms };
      const response = await api<
        ApiData<{ user: Account; csrfToken: string; accessExpiresAt: number }>
      >(path, { method: 'POST', body: JSON.stringify(body), retryAuth: false });
      setCsrfToken(response.data.csrfToken);
      onAuthenticated(response.data.user);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'totp_required') needsTotp = true;
      error = caught instanceof Error ? caught.message : 'Sign in failed.';
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth-page">
  <section class="auth-story" aria-label="About NEXA">
    <div class="brand-lockup">
      <div class="brand-mark" aria-hidden="true">N</div>
      <strong>{APP_NAME}</strong>
    </div>
    <div class="story-copy">
      <p class="eyebrow">YOUR PEOPLE. ONE PLACE.</p>
      <h1>Built for the conversations that matter.</h1>
      <p>
        Communities, close friends, and everything you share — without trackers, clutter, or a
        heavyweight client.
      </p>
      <div class="story-pills" aria-hidden="true">
        <span>◉ Live communities</span><span>✦ Private chats</span><span>⌁ Voice rooms</span>
      </div>
    </div>
    <p class="story-foot">Open source · Privacy first · Lightweight by design</p>
  </section>

  <section class="auth-form-side">
    <div class="auth-card">
      <div class="mobile-brand">
        <div class="brand-mark" aria-hidden="true">N</div>
        <strong>{APP_NAME}</strong>
      </div>
      <p class="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN NEXA'}</p>
      <h2>{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</h2>
      <p class="auth-subtitle">
        {mode === 'login'
          ? 'Your communities are waiting.'
          : 'Start with a profile. Find your people.'}
      </p>

      {#if error}
        <div class="error-banner" role="alert">{error}</div>
      {/if}

      <form onsubmit={submit} class="auth-form">
        {#if mode === 'register'}
          <div class="form-row">
            <div class="field">
              <label for="display-name">Display name</label>
              <input
                id="display-name"
                bind:value={displayName}
                maxlength="50"
                autocomplete="name"
                required
              />
            </div>
            <div class="field">
              <label for="username">Username</label>
              <input
                id="username"
                bind:value={username}
                pattern={'[a-zA-Z0-9_]{3,24}'}
                maxlength="24"
                autocomplete="username"
                required
              />
            </div>
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              bind:value={email}
              maxlength="254"
              autocomplete="email"
              required
            />
          </div>
        {:else}
          <div class="field">
            <label for="identifier">Email or username</label>
            <input
              id="identifier"
              bind:value={identifier}
              maxlength="254"
              autocomplete="username"
              required
            />
          </div>
        {/if}

        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            bind:value={password}
            minlength={mode === 'register' ? 12 : 1}
            maxlength="128"
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
          {#if mode === 'register'}
            <small class="muted">12+ characters with uppercase, lowercase, and a number.</small>
          {/if}
        </div>

        {#if needsTotp && mode === 'login'}
          <div class="field">
            <label for="totp">Authentication code</label>
            <input
              id="totp"
              bind:value={totp}
              inputmode="numeric"
              pattern="[0-9]{6}"
              maxlength="6"
              autocomplete="one-time-code"
              required
            />
          </div>
        {/if}

        {#if mode === 'register'}
          <div class="field">
            <label for="birth-date">Date of birth</label>
            <input
              id="birth-date"
              type="date"
              bind:value={birthDate}
              autocomplete="bday"
              required
            />
            <small class="muted">You must be at least 13.</small>
          </div>
          <label class="check-row">
            <input type="checkbox" bind:checked={acceptTerms} required />
            <span
              >I agree to the <a href="/legal/terms" target="_blank">Terms</a> and
              <a href="/legal/privacy" target="_blank">Privacy Policy</a>.</span
            >
          </label>
        {/if}

        <button class="primary-button auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p class="auth-switch">
        {mode === 'login' ? 'New to NEXA?' : 'Already have an account?'}
        <button
          type="button"
          onclick={() => {
            mode = mode === 'login' ? 'register' : 'login';
            error = '';
            needsTotp = false;
          }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button
        >
      </p>
    </div>
  </section>
</main>

<style>
  .auth-page {
    display: grid;
    min-height: 100dvh;
    grid-template-columns: minmax(420px, 1.08fr) minmax(440px, 0.92fr);
    overflow: auto;
    background: var(--bg-deep);
  }
  .auth-story {
    position: relative;
    display: flex;
    min-height: 100dvh;
    flex-direction: column;
    padding: 46px clamp(38px, 7vw, 100px);
    overflow: hidden;
    background:
      radial-gradient(circle at 28% 32%, rgb(124 58 237 / 28%), transparent 42%),
      radial-gradient(circle at 85% 80%, rgb(79 70 229 / 20%), transparent 34%), #0b0b11;
  }
  .auth-story::before {
    position: absolute;
    width: 500px;
    height: 500px;
    border: 1px solid rgb(167 139 250 / 10%);
    border-radius: 50%;
    content: '';
    inset: 22% auto auto 18%;
    box-shadow:
      0 0 0 70px rgb(167 139 250 / 3%),
      0 0 0 140px rgb(167 139 250 / 2%);
  }
  .brand-lockup,
  .mobile-brand {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.1rem;
    letter-spacing: 0.18em;
  }
  .brand-mark {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 13px;
    background: linear-gradient(135deg, #a78bfa, #6d28d9);
    color: white;
    font-size: 1.2rem;
    font-weight: 900;
    box-shadow: 0 12px 36px rgb(109 40 217 / 35%);
  }
  .story-copy {
    position: relative;
    z-index: 1;
    max-width: 650px;
    margin: auto 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    color: #a78bfa;
    font-size: 0.72rem;
    font-weight: 850;
    letter-spacing: 0.2em;
  }
  .story-copy h1 {
    max-width: 620px;
    margin: 0;
    font-size: clamp(3rem, 6vw, 6.5rem);
    font-weight: 830;
    letter-spacing: -0.065em;
    line-height: 0.98;
  }
  .story-copy > p:not(.eyebrow) {
    max-width: 560px;
    margin: 28px 0;
    color: #aaa6b7;
    font-size: clamp(1rem, 1.4vw, 1.2rem);
  }
  .story-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
  }
  .story-pills span {
    padding: 8px 12px;
    border: 1px solid rgb(167 139 250 / 15%);
    border-radius: 999px;
    background: rgb(255 255 255 / 4%);
    color: #c4b5fd;
    font-size: 0.8rem;
  }
  .story-foot {
    position: relative;
    z-index: 1;
    margin: 0;
    color: #656271;
    font-size: 0.75rem;
  }
  .auth-form-side {
    display: grid;
    min-height: 100dvh;
    padding: 44px clamp(28px, 6vw, 90px);
    place-items: center;
    background: var(--bg-panel);
  }
  .auth-card {
    width: min(440px, 100%);
  }
  .auth-card h2 {
    margin: 0;
    font-size: clamp(1.8rem, 3vw, 2.45rem);
    letter-spacing: -0.04em;
  }
  .auth-subtitle {
    margin: 8px 0 26px;
    color: var(--text-muted);
  }
  .auth-form {
    display: grid;
    gap: 15px;
    margin-top: 16px;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .check-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    color: var(--text-soft);
    font-size: 0.82rem;
  }
  .check-row input {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    accent-color: var(--brand);
  }
  .auth-submit {
    width: 100%;
    min-height: 48px;
    margin-top: 4px;
  }
  .auth-switch {
    color: var(--text-muted);
    font-size: 0.86rem;
    text-align: center;
  }
  .auth-switch button {
    padding: 5px;
    background: transparent;
    color: #a78bfa;
    font-weight: 700;
  }
  .mobile-brand {
    display: none;
    margin-bottom: 40px;
  }
  @media (max-width: 880px) {
    .auth-page {
      display: block;
    }
    .auth-story {
      display: none;
    }
    .auth-form-side {
      min-height: 100dvh;
      padding: 28px 20px;
    }
    .mobile-brand {
      display: flex;
    }
  }
  @media (max-width: 460px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>
