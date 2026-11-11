<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { Account, ApiData } from '../client-types';
  import { preferences, updatePreference, type Preferences } from '../preferences';
  import { uploadFile } from '../image';
  import Avatar from './Avatar.svelte';

  let {
    account,
    onUpdated,
    onLogout,
    onToggleNavigation,
    notify,
  }: {
    account: Account;
    onUpdated: (account: Account) => void;
    onLogout: () => void;
    onToggleNavigation: () => void;
    notify: (message: string, error?: boolean) => void;
  } = $props();

  let tab = $state<'profile' | 'appearance' | 'privacy' | 'security' | 'sessions' | 'about'>(
    'profile',
  );
  let displayName = $state('');
  let bio = $state('');
  let status = $state<'online' | 'idle' | 'dnd' | 'invisible'>('online');
  let avatarKey = $state<string | null | undefined>(undefined);
  let saving = $state(false);
  let privacy = $state({ discoverable: true, dmFrom: 'everyone', showStatus: true });
  let sessions = $state<
    Array<{ id: string; userAgent: string; lastSeenAt: string; current: boolean }>
  >([]);
  let setup = $state<{ secret: string; setupToken: string; otpauthUrl: string } | null>(null);
  let totpCode = $state('');
  let disablePassword = $state('');
  let deletePassword = $state('');
  let deleting = $state(false);
  let fileInput = $state<HTMLInputElement>();

  async function saveProfile(): Promise<void> {
    saving = true;
    try {
      await api('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, bio, status, avatarKey }),
      });
      const response = await api<ApiData<Account>>('/auth/me');
      onUpdated(response.data);
      notify('Profile updated.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save profile.', true);
    } finally {
      saving = false;
    }
  }

  async function uploadAvatar(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadFile(file);
      avatarKey = uploaded.key;
      notify('Avatar ready — save your profile to apply it.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Avatar upload failed.', true);
    }
  }

  async function loadPrivacy(): Promise<void> {
    const response = await api<ApiData<typeof privacy>>('/privacy');
    if (response.data) privacy = response.data;
  }

  async function savePrivacy(): Promise<void> {
    await api('/privacy', { method: 'PUT', body: JSON.stringify(privacy) });
    notify('Privacy settings updated.');
  }

  async function loadSessions(): Promise<void> {
    const response = await api<ApiData<typeof sessions>>('/auth/sessions');
    sessions = response.data;
  }

  async function revokeSession(id: string): Promise<void> {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' });
    sessions = sessions.filter((session) => session.id !== id);
    if (sessions.every((session) => !session.current)) onLogout();
  }

  async function beginTotp(): Promise<void> {
    const response = await api<ApiData<NonNullable<typeof setup>>>('/auth/totp/setup', {
      method: 'POST',
    });
    setup = response.data;
  }

  async function enableTotp(): Promise<void> {
    if (!setup) return;
    await api('/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ setupToken: setup.setupToken, code: totpCode }),
    });
    setup = null;
    totpCode = '';
    onUpdated({ ...account, totpEnabled: true });
    notify('Two-factor authentication enabled.');
  }

  async function disableTotp(): Promise<void> {
    await api('/auth/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ password: disablePassword, code: totpCode }),
    });
    disablePassword = '';
    totpCode = '';
    onUpdated({ ...account, totpEnabled: false });
    notify('Two-factor authentication disabled.');
  }

  function urlBase64ToUint8Array(value: string): Uint8Array {
    const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
    const bytes = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
  }

  async function enablePush(): Promise<void> {
    const publicKey = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY as string | undefined;
    if (!publicKey) {
      notify('Push notifications require PUBLIC_VAPID_PUBLIC_KEY.', true);
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const json = subscription.toJSON();
    await api('/push-subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: json.keys,
        platform: 'web',
      }),
    });
    notify('Push notifications enabled.');
  }

  async function deleteAccount(): Promise<void> {
    if (!deletePassword || !confirm('Permanently delete your NEXA account and content?')) return;
    deleting = true;
    try {
      await api('/auth/me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      onLogout();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Account deletion failed.', true);
    } finally {
      deleting = false;
    }
  }

  onMount(() => {
    displayName = account.displayName;
    bio = account.bio ?? '';
    void loadPrivacy();
    void loadSessions();
  });
</script>

<main class="settings-panel">
  <header class="panel-header settings-header">
    <button
      class="icon-button mobile-only"
      type="button"
      onclick={onToggleNavigation}
      aria-label="Open navigation">☰</button
    >
    <h1>Settings</h1>
  </header>
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections">
      {#each [['profile', 'Profile'], ['appearance', 'Appearance'], ['privacy', 'Privacy'], ['security', 'Security'], ['sessions', 'Devices'], ['about', 'About']] as item}
        <button
          class:active={tab === item[0]}
          type="button"
          onclick={() => (tab = item[0] as typeof tab)}>{item[1]}</button
        >
      {/each}
      <button class="logout-link" type="button" onclick={onLogout}>Log out</button>
    </nav>
    <div class="settings-content">
      {#if tab === 'profile'}
        <section>
          <p class="eyebrow">MY ACCOUNT</p>
          <h2>Profile</h2>
          <p class="section-copy">Choose how you appear across NEXA.</p>
          <div class="profile-banner">
            <Avatar
              src={account.avatarUrl}
              name={account.displayName}
              status={account.status}
              size={72}
            />
            <div>
              <strong>{account.displayName}</strong><span>@{account.username}</span><input
                bind:this={fileInput}
                class="sr-only"
                type="file"
                accept="image/*"
                onchange={(event) => void uploadAvatar(event.currentTarget.files)}
              /><button class="secondary-button" type="button" onclick={() => fileInput?.click()}
                >Change avatar</button
              >
            </div>
          </div>
          <div class="settings-form">
            <div class="field">
              <label for="settings-name">Display name</label><input
                id="settings-name"
                bind:value={displayName}
                maxlength="50"
              />
            </div>
            <div class="field">
              <label for="settings-bio">Bio</label><textarea
                id="settings-bio"
                bind:value={bio}
                maxlength="300"
                rows="4"></textarea><small class="muted">{bio.length}/300</small>
            </div>
            <div class="field">
              <label for="settings-status">Status</label><select
                id="settings-status"
                bind:value={status}
                ><option value="online">Online</option><option value="idle">Idle</option><option
                  value="dnd">Do not disturb</option
                ><option value="invisible">Invisible</option></select
              >
            </div>
            <button
              class="primary-button save"
              type="button"
              onclick={() => void saveProfile()}
              disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button
            >
          </div>
        </section>
      {:else if tab === 'appearance'}
        <section>
          <p class="eyebrow">PERSONALIZE</p>
          <h2>Appearance</h2>
          <p class="section-copy">Settings are stored only on this device.</p>
          <div class="setting-row">
            <div><strong>Theme</strong><small>Choose a color scheme.</small></div>
            <select
              value={$preferences.theme}
              onchange={(event) =>
                updatePreference('theme', event.currentTarget.value as Preferences['theme'])}
              ><option value="dark">Dark</option><option value="light">Light</option><option
                value="system">System</option
              ></select
            >
          </div>
          <div class="setting-row">
            <div>
              <strong>Language</strong><small>Arabic includes full right-to-left layout.</small>
            </div>
            <select
              value={$preferences.locale}
              onchange={(event) =>
                updatePreference('locale', event.currentTarget.value as Preferences['locale'])}
              ><option value="en">English</option><option value="ar">العربية</option></select
            >
          </div>
          <label class="setting-row"
            ><div>
              <strong>Low-power mode</strong><small
                >Stops animations, lowers heartbeat frequency, and avoids automatic media.</small
              >
            </div>
            <input
              type="checkbox"
              checked={$preferences.lowPower}
              onchange={(event) => updatePreference('lowPower', event.currentTarget.checked)}
            /></label
          >
          <label class="setting-row"
            ><div>
              <strong>Compact layout</strong><small>Fit more channels and messages on screen.</small
              >
            </div>
            <input
              type="checkbox"
              checked={$preferences.compact}
              onchange={(event) => updatePreference('compact', event.currentTarget.checked)}
            /></label
          >
          <label class="setting-row"
            ><div>
              <strong>Offline content</strong><small
                >Cache recently viewed content on this device. Cleared on logout.</small
              >
            </div>
            <input
              type="checkbox"
              checked={$preferences.offlineCache}
              onchange={(event) => updatePreference('offlineCache', event.currentTarget.checked)}
            /></label
          >
        </section>
      {:else if tab === 'privacy'}
        <section>
          <p class="eyebrow">YOUR CONTROL</p>
          <h2>Privacy</h2>
          <p class="section-copy">NEXA has no third-party trackers.</p>
          <label class="setting-row"
            ><div>
              <strong>Discoverable profile</strong><small>Allow people to find you in search.</small
              >
            </div>
            <input type="checkbox" bind:checked={privacy.discoverable} /></label
          >
          <div class="setting-row">
            <div><strong>Direct messages</strong><small>Who can start a private chat.</small></div>
            <select bind:value={privacy.dmFrom}
              ><option value="everyone">Everyone</option><option value="friends">Friends</option
              ><option value="none">Nobody</option></select
            >
          </div>
          <label class="setting-row"
            ><div>
              <strong>Show status</strong><small>Let other people see when you are online.</small>
            </div>
            <input type="checkbox" bind:checked={privacy.showStatus} /></label
          >
          <button class="primary-button save" type="button" onclick={() => void savePrivacy()}
            >Save privacy settings</button
          >
          <div class="data-actions">
            <a
              class="secondary-button"
              href={`${(import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8787/v1'}/auth/export`}
              target="_blank">Export my data</a
            >
          </div>
        </section>
      {:else if tab === 'security'}
        <section>
          <p class="eyebrow">ACCOUNT SECURITY</p>
          <h2>Two-factor authentication</h2>
          <p class="section-copy">Use any TOTP authenticator app for a second sign-in factor.</p>
          {#if account.totpEnabled}
            <div class="notice-banner">Two-factor authentication is enabled.</div>
            <div class="settings-form">
              <div class="field">
                <label for="disable-password">Current password</label><input
                  id="disable-password"
                  type="password"
                  bind:value={disablePassword}
                />
              </div>
              <div class="field">
                <label for="disable-code">6-digit code</label><input
                  id="disable-code"
                  inputmode="numeric"
                  maxlength="6"
                  bind:value={totpCode}
                />
              </div>
              <button class="danger-button save" type="button" onclick={() => void disableTotp()}
                >Disable 2FA</button
              >
            </div>
          {:else if setup}
            <div class="totp-secret">
              <span>Authenticator secret</span><code>{setup.secret}</code><small
                >Enter this key in your authenticator. It expires in 10 minutes.</small
              >
            </div>
            <div class="settings-form">
              <div class="field">
                <label for="enable-code">6-digit code</label><input
                  id="enable-code"
                  inputmode="numeric"
                  maxlength="6"
                  bind:value={totpCode}
                />
              </div>
              <button class="primary-button save" type="button" onclick={() => void enableTotp()}
                >Verify and enable</button
              >
            </div>
          {:else}<button class="primary-button" type="button" onclick={() => void beginTotp()}
              >Set up 2FA</button
            >{/if}
          <hr />
          <h3>Notifications</h3>
          <p class="section-copy">Receive Web Push alerts even when NEXA is closed.</p>
          <button class="secondary-button" type="button" onclick={() => void enablePush()}
            >Enable push notifications</button
          >
        </section>
      {:else if tab === 'sessions'}
        <section>
          <p class="eyebrow">ACTIVE DEVICES</p>
          <h2>Sessions</h2>
          <p class="section-copy">Revoke any session you do not recognize.</p>
          <div class="session-list">
            {#each sessions as session (session.id)}<div class="session-row">
                <span class="device-icon">▣</span>
                <div>
                  <strong
                    >{session.userAgent || 'Unknown device'}
                    {session.current ? '(this device)' : ''}</strong
                  ><small>Last active {new Date(session.lastSeenAt).toLocaleString()}</small>
                </div>
                <button
                  class="ghost-button"
                  type="button"
                  onclick={() => void revokeSession(session.id)}
                  >{session.current ? 'Log out' : 'Revoke'}</button
                >
              </div>{/each}
          </div>
        </section>
      {:else}
        <section>
          <p class="eyebrow">NEXA</p>
          <h2>About</h2>
          <p class="section-copy">Version 0.1.0 · Open-source community and messaging software.</p>
          <div class="about-links">
            <a href="/legal/privacy">Privacy policy</a><a href="/legal/terms">Terms of use</a><a
              href="https://github.com"
              target="_blank"
              rel="noreferrer">Source code</a
            >
          </div>
          <hr />
          <h3>Delete account</h3>
          <p class="section-copy">
            Permanently removes your profile and cascades deletion through your posts, messages,
            uploads, and memberships.
          </p>
          <div class="delete-row">
            <input
              class="text-input"
              type="password"
              bind:value={deletePassword}
              placeholder="Confirm your password"
            /><button
              class="danger-button"
              type="button"
              onclick={() => void deleteAccount()}
              disabled={deleting}>{deleting ? 'Deleting…' : 'Delete account'}</button
            >
          </div>
        </section>
      {/if}
    </div>
  </div>
</main>

<style>
  .settings-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    grid-column: 2 / -1;
    background: var(--bg-deep);
  }
  .settings-layout {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: 210px minmax(0, 720px);
    justify-content: center;
    overflow-y: auto;
  }
  .settings-nav {
    position: sticky;
    display: flex;
    height: fit-content;
    flex-direction: column;
    gap: 3px;
    padding: 38px 18px;
    inset-block-start: 0;
  }
  .settings-nav button {
    min-height: 38px;
    padding: 0 12px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    text-align: start;
  }
  .settings-nav button:hover,
  .settings-nav button.active {
    background: var(--bg-hover);
    color: var(--text);
  }
  .settings-nav button.active {
    color: #c4b5fd;
    font-weight: 700;
  }
  .settings-nav .logout-link {
    margin-top: 14px;
    color: var(--red);
  }
  .settings-content {
    padding: 42px 30px 90px;
  }
  .settings-content section {
    max-width: 650px;
  }
  .settings-content h2 {
    margin: 0;
    font-size: 1.75rem;
    letter-spacing: -0.04em;
  }
  .settings-content h3 {
    margin-bottom: 4px;
  }
  .section-copy {
    margin: 7px 0 25px;
    color: var(--text-muted);
  }
  .profile-banner {
    display: flex;
    align-items: center;
    gap: 17px;
    margin-bottom: 24px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-panel);
  }
  .profile-banner > div {
    display: grid;
    align-items: center;
    grid-template-columns: 1fr auto;
    gap: 2px 15px;
    flex: 1;
  }
  .profile-banner strong,
  .profile-banner span {
    display: block;
  }
  .profile-banner span {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .profile-banner button {
    grid-area: 1 / 2 / 3;
  }
  .settings-form {
    display: grid;
    gap: 16px;
  }
  .save {
    width: fit-content;
    margin-top: 6px;
  }
  .setting-row {
    display: flex;
    min-height: 70px;
    align-items: center;
    gap: 20px;
    padding: 13px 0;
    border-block-end: 1px solid var(--line);
  }
  .setting-row > div {
    flex: 1;
  }
  .setting-row strong,
  .setting-row small {
    display: block;
  }
  .setting-row strong {
    font-size: 0.88rem;
  }
  .setting-row small {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .setting-row select {
    min-width: 130px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--text);
    padding: 7px 9px;
  }
  .setting-row input[type='checkbox'] {
    width: 38px;
    height: 20px;
    accent-color: var(--brand);
  }
  .data-actions {
    margin-top: 28px;
  }
  .data-actions a {
    display: inline-grid;
    align-items: center;
  }
  .totp-secret {
    display: grid;
    gap: 7px;
    margin-bottom: 20px;
    padding: 16px;
    border: 1px solid var(--brand);
    border-radius: 12px;
    background: var(--brand-soft);
  }
  .totp-secret span,
  .totp-secret small {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .totp-secret code {
    overflow-wrap: anywhere;
    color: #c4b5fd;
    font-size: 1rem;
    letter-spacing: 0.1em;
  }
  hr {
    margin: 32px 0;
    border: 0;
    border-block-start: 1px solid var(--line);
  }
  .session-list {
    display: grid;
    gap: 8px;
  }
  .session-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--bg-panel);
  }
  .session-row > div {
    min-width: 0;
    flex: 1;
  }
  .session-row strong,
  .session-row small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-row strong {
    font-size: 0.78rem;
  }
  .session-row small {
    color: var(--text-muted);
    font-size: 0.66rem;
  }
  .device-icon {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 9px;
    background: var(--brand-soft);
    color: #a78bfa;
  }
  .about-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
  }
  .delete-row {
    display: flex;
    gap: 8px;
  }
  .delete-row input {
    max-width: 320px;
  }
  @media (max-width: 720px) {
    .settings-panel {
      height: calc(100dvh - 58px);
    }
    .settings-layout {
      display: block;
    }
    .settings-nav {
      position: static;
      flex-direction: row;
      justify-content: flex-start;
      padding: 8px;
      overflow-x: auto;
    }
    .settings-nav button {
      flex: 0 0 auto;
    }
    .settings-nav .logout-link {
      margin: 0;
    }
    .settings-content {
      padding: 24px 16px 70px;
    }
    .profile-banner {
      align-items: flex-start;
    }
    .profile-banner > div {
      display: block;
    }
    .profile-banner button {
      margin-top: 8px;
    }
    .delete-row {
      flex-direction: column;
    }
  }
</style>
