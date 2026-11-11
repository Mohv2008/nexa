<script lang="ts">
  import type { Channel } from '@nexa/shared';
  import type { ClientMessage } from '../client-types';
  import { uploadFile } from '../image';
  import VirtualMessageList from './VirtualMessageList.svelte';

  let {
    channel,
    title,
    subtitle = '',
    messages,
    currentUserId,
    loading,
    hasOlder = false,
    typingUsers = [],
    voiceState = 'closed',
    onSend,
    onLoadOlder,
    onReact,
    onRead,
    onTyping,
    onJoinVoice,
    onLeaveVoice,
    onToggleSidebar,
    onToggleMembers,
    onSearch,
  }: {
    channel: Channel | null;
    title?: string;
    subtitle?: string;
    messages: ClientMessage[];
    currentUserId: string;
    loading: boolean;
    hasOlder?: boolean;
    typingUsers?: string[];
    voiceState?: 'connecting' | 'connected' | 'closed' | 'error';
    onSend: (content: string, attachmentKeys: string[], replyTo: string | null) => Promise<void>;
    onLoadOlder: () => void;
    onReact: (messageId: string, emoji: string, reacted: boolean) => void;
    onRead: (messageId: string) => void;
    onTyping: (active: boolean) => void;
    onJoinVoice: () => void;
    onLeaveVoice: () => void;
    onToggleSidebar: () => void;
    onToggleMembers: () => void;
    onSearch: () => void;
  } = $props();

  let content = $state('');
  let sending = $state(false);
  let uploading = $state(false);
  let uploadError = $state('');
  let attachments = $state<Array<{ key: string; name: string }>>([]);
  let replyingTo = $state<ClientMessage | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let recorder = $state<MediaRecorder | null>(null);
  let recording = $state(false);
  let recordingStream: MediaStream | null = null;
  let typingTimer: number | null = null;

  const displayTitle = $derived(title ?? channel?.name ?? 'Select a channel');

  async function submit(): Promise<void> {
    if (sending || (!content.trim() && attachments.length === 0)) return;
    sending = true;
    try {
      await onSend(
        content.trim(),
        attachments.map((item) => item.key),
        replyingTo?.id ?? null,
      );
      content = '';
      attachments = [];
      replyingTo = null;
      onTyping(false);
      const last = messages.at(-1);
      if (last) onRead(last.id);
    } finally {
      sending = false;
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function inputChanged(): void {
    onTyping(true);
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => onTyping(false), 2500);
  }

  async function addFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    uploading = true;
    uploadError = '';
    try {
      for (const file of [...files].slice(0, 10 - attachments.length)) {
        const uploaded = await uploadFile(file);
        attachments = [...attachments, { key: uploaded.key, name: uploaded.name }];
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : 'Upload failed.';
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording && recorder) {
      recorder.stop();
      recording = false;
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
      uploadError = 'Voice recording is not supported by this browser.';
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingStream = stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const chunks: Blob[] = [];
    const nextRecorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
    nextRecorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    nextRecorder.onstop = () => {
      for (const track of recordingStream?.getTracks() ?? []) track.stop();
      recordingStream = null;
      const file = new File(chunks, `voice-${Date.now()}.webm`, { type: mime });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      void addFiles(transfer.files);
      recorder = null;
    };
    recorder = nextRecorder;
    nextRecorder.start(1000);
    recording = true;
  }
</script>

<main class="chat-panel">
  <header class="panel-header chat-header">
    <button
      class="icon-button mobile-only"
      type="button"
      onclick={onToggleSidebar}
      aria-label="Open channels">☰</button
    >
    <span class="header-glyph" aria-hidden="true">{channel?.type === 'voice' ? '◖' : '#'}</span>
    <div class="channel-title">
      <h1>{displayTitle}</h1>
      {#if subtitle || channel?.topic}<small>{subtitle || channel?.topic}</small>{/if}
    </div>
    <div class="header-spacer"></div>
    <button
      class="icon-button"
      type="button"
      onclick={onSearch}
      aria-label="Search messages"
      title="Search">⌕</button
    >
    <button
      class="icon-button mobile-only"
      type="button"
      onclick={onToggleMembers}
      aria-label="Show members">♙</button
    >
  </header>

  {#if !channel && !title}
    <div class="empty-state">
      <div class="empty-icon">#</div>
      <strong>Choose a channel</strong>
      <p>Select a conversation from the sidebar.</p>
    </div>
  {:else if channel?.type === 'voice'}
    <section class="voice-landing">
      <div class="voice-orb"><span>◖</span><i></i><b></b></div>
      <p class="eyebrow">PEER-TO-PEER VOICE</p>
      <h2>{channel.name}</h2>
      <p>Encrypted in transit. Small rooms connect directly between participants.</p>
      {#if voiceState === 'connected'}
        <button class="danger-button" type="button" onclick={onLeaveVoice}>Leave voice</button>
      {:else}
        <button
          class="primary-button"
          type="button"
          onclick={onJoinVoice}
          disabled={voiceState === 'connecting'}
        >
          {voiceState === 'connecting' ? 'Connecting…' : 'Join voice'}
        </button>
      {/if}
    </section>
  {:else}
    <VirtualMessageList
      {messages}
      {currentUserId}
      {loading}
      {hasOlder}
      {onLoadOlder}
      {onReact}
      onReply={(message) => (replyingTo = message)}
    />
    <div class="composer-wrap">
      {#if replyingTo}
        <div class="reply-preview">
          <span>Replying to <strong>{replyingTo.author.displayName}</strong></span><button
            type="button"
            onclick={() => (replyingTo = null)}
            aria-label="Cancel reply">✕</button
          >
        </div>
      {/if}
      {#if attachments.length}
        <div class="attachment-preview">
          {#each attachments as attachment, index}
            <span
              >📎 {attachment.name}<button
                type="button"
                onclick={() =>
                  (attachments = attachments.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={`Remove ${attachment.name}`}>✕</button
              ></span
            >
          {/each}
        </div>
      {/if}
      {#if uploadError}<p class="upload-error" role="alert">{uploadError}</p>{/if}
      {#if typingUsers.length}<p class="typing-copy">
          {typingUsers.slice(0, 3).join(', ')}
          {typingUsers.length === 1 ? 'is' : 'are'} typing…
        </p>{/if}
      <div class="composer">
        <input
          bind:this={fileInput}
          class="sr-only"
          type="file"
          multiple
          onchange={(event) => void addFiles(event.currentTarget.files)}
        />
        <button
          class="composer-tool"
          type="button"
          onclick={() => fileInput?.click()}
          disabled={uploading}
          aria-label="Attach a file">{uploading ? '…' : '＋'}</button
        >
        <textarea
          bind:value={content}
          oninput={inputChanged}
          onkeydown={keydown}
          rows="1"
          maxlength="4000"
          placeholder={`Message ${displayTitle}`}
          aria-label={`Message ${displayTitle}`}></textarea>
        <button
          class:recording
          class="composer-tool"
          type="button"
          onclick={() => void toggleRecording()}
          aria-label={recording ? 'Stop voice recording' : 'Record a voice note'}>●</button
        >
        <button
          class="send-button"
          type="button"
          onclick={() => void submit()}
          disabled={sending || (!content.trim() && attachments.length === 0)}
          aria-label="Send message">➤</button
        >
      </div>
    </div>
  {/if}
</main>

<style>
  .chat-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    background: var(--bg-panel);
  }
  .header-glyph {
    color: var(--text-muted);
    font-size: 1.25rem;
  }
  .channel-title {
    min-width: 0;
  }
  .channel-title small {
    display: block;
    max-width: min(48vw, 560px);
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .composer-wrap {
    flex: 0 0 auto;
    padding: 0 18px 18px;
  }
  .composer {
    display: flex;
    min-height: 48px;
    align-items: flex-end;
    gap: 5px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--bg-input);
  }
  .composer:focus-within {
    border-color: rgb(139 92 246 / 55%);
    box-shadow: 0 0 0 3px var(--brand-soft);
  }
  .composer textarea {
    min-height: 37px;
    max-height: 180px;
    flex: 1;
    resize: none;
    border: 0;
    background: transparent;
    color: var(--text);
    padding: 8px 6px;
    line-height: 1.35;
  }
  .composer-tool,
  .send-button {
    display: grid;
    width: 37px;
    height: 37px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
  }
  .composer-tool:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .composer-tool.recording {
    color: var(--red);
    animation: pulse 1s infinite;
  }
  .send-button {
    background: var(--brand);
    color: white;
  }
  .reply-preview {
    display: flex;
    align-items: center;
    padding: 7px 10px;
    border-radius: 9px 9px 0 0;
    background: var(--bg-raised);
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .reply-preview span {
    flex: 1;
  }
  .reply-preview button,
  .attachment-preview button {
    background: transparent;
    color: var(--text-muted);
  }
  .attachment-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 5px;
  }
  .attachment-preview > span {
    padding: 5px 7px;
    border-radius: 7px;
    background: var(--bg-raised);
    color: var(--text-soft);
    font-size: 0.68rem;
  }
  .upload-error,
  .typing-copy {
    margin: 0 5px 5px;
    font-size: 0.67rem;
  }
  .upload-error {
    color: var(--red);
  }
  .typing-copy {
    color: var(--text-muted);
  }
  .voice-landing {
    display: grid;
    min-height: 0;
    flex: 1;
    place-content: center;
    justify-items: center;
    padding: 30px;
    text-align: center;
  }
  .voice-landing h2 {
    margin: 2px 0 8px;
    font-size: 2rem;
  }
  .voice-landing > p:not(.eyebrow) {
    max-width: 430px;
    margin: 0 0 24px;
    color: var(--text-muted);
  }
  .voice-orb {
    position: relative;
    display: grid;
    width: 126px;
    height: 126px;
    margin-bottom: 28px;
    place-items: center;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(139 92 246 / 28%), transparent 68%);
    color: #c4b5fd;
    font-size: 2.8rem;
  }
  .voice-orb i,
  .voice-orb b {
    position: absolute;
    border: 1px solid rgb(139 92 246 / 28%);
    border-radius: 50%;
    inset: 8px;
    animation: voice-wave 2.3s infinite;
  }
  .voice-orb b {
    inset: -10px;
    animation-delay: 0.7s;
  }
  @keyframes voice-wave {
    50% {
      transform: scale(1.08);
      opacity: 0.45;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  @media (max-width: 720px) {
    .composer-wrap {
      padding: 0 8px 9px;
    }
    .chat-header {
      padding-inline: 6px;
    }
  }
</style>
