<script lang="ts">
  import { onMount } from 'svelte';

  const releasePage =
    (import.meta.env.PUBLIC_RELEASE_URL as string | undefined) ??
    'https://github.com/your-org/nexa/releases/latest';
  const windowsDownload =
    (import.meta.env.PUBLIC_WINDOWS_DOWNLOAD_URL as string | undefined) ?? releasePage;
  const androidDownload =
    (import.meta.env.PUBLIC_ANDROID_DOWNLOAD_URL as string | undefined) ?? releasePage;

  let platform = $state<'windows' | 'android' | 'web'>('web');
  let menuOpen = $state(false);
  let videoPaused = $state(false);
  let reducedMotion = $state(false);
  let promoVideo: HTMLVideoElement | undefined = $state();

  const primaryDownload = $derived(
    platform === 'windows'
      ? { label: 'Download for Windows', href: windowsDownload, icon: '⊞' }
      : platform === 'android'
        ? { label: 'Download Android APK', href: androidDownload, icon: '◆' }
        : { label: 'Continue in browser', href: '/app', icon: '↗' },
  );

  function toggleVideo(): void {
    if (!promoVideo) return;
    if (promoVideo.paused) {
      void promoVideo.play();
      videoPaused = false;
    } else {
      promoVideo.pause();
      videoPaused = true;
    }
  }

  function startPromoAfterIntro(): void {
    if (!promoVideo || !Number.isFinite(promoVideo.duration) || promoVideo.duration < 1.5) return;
    if (promoVideo.currentTime < 0.8)
      promoVideo.currentTime = Math.min(1.2, promoVideo.duration / 3);
  }

  function scrollToSection(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    menuOpen = false;
  }

  onMount(() => {
    const nativeWindow = window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean };
      __TAURI_INTERNALS__?: unknown;
    };
    if (nativeWindow.Capacitor?.isNativePlatform?.() || nativeWindow.__TAURI_INTERNALS__) {
      location.replace('/app');
      return;
    }
    document.documentElement.classList.add('landing-active');
    document.body.classList.add('landing-active');

    const agent = navigator.userAgent.toLowerCase();
    platform = /android/u.test(agent) ? 'android' : /windows/u.test(agent) ? 'windows' : 'web';
    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add('is-visible');
        }
      },
      { threshold: 0.12 },
    );
    document
      .querySelectorAll('[data-reveal]')
      .forEach((element) => revealObserver.observe(element));

    const pointerMove = (event: PointerEvent): void => {
      if (reducedMotion) return;
      const x = event.clientX / innerWidth - 0.5;
      const y = event.clientY / innerHeight - 0.5;
      document.documentElement.style.setProperty('--pointer-x', String(x));
      document.documentElement.style.setProperty('--pointer-y', String(y));
    };
    window.addEventListener('pointermove', pointerMove, { passive: true });

    if (reducedMotion) {
      promoVideo?.pause();
      videoPaused = true;
    }

    return () => {
      revealObserver.disconnect();
      window.removeEventListener('pointermove', pointerMove);
      document.documentElement.classList.remove('landing-active');
      document.body.classList.remove('landing-active');
      document.documentElement.style.removeProperty('--pointer-x');
      document.documentElement.style.removeProperty('--pointer-y');
    };
  });
</script>

<svelte:head>
  <title>NEXA — Your people. One place.</title>
  <meta
    name="description"
    content="Download NEXA for Windows or Android, or continue in your browser. Communities, chat, posts, and voice in one lightweight app."
  />
  <meta property="og:title" content="NEXA — Your people. One place." />
  <meta
    property="og:description"
    content="Communities, private chat, social posts, and voice — without the heavyweight client."
  />
  <meta property="og:image" content="/images/nexa-community.png" />
</svelte:head>

<div class="landing-shell">
  <div class="noise" aria-hidden="true"></div>
  <div class="orb orb-one" aria-hidden="true"></div>
  <div class="orb orb-two" aria-hidden="true"></div>
  <div class="orb orb-three" aria-hidden="true"></div>

  <header class="site-header">
    <a class="landing-brand" href="/" aria-label="NEXA home">
      <span class="brand-glyph">N</span>
      <strong>NEXA</strong>
    </a>
    <button
      class="menu-toggle"
      class:active={menuOpen}
      type="button"
      onclick={() => (menuOpen = !menuOpen)}
      aria-label="Toggle navigation"
      aria-expanded={menuOpen}><i></i><i></i></button
    >
    <nav class:open={menuOpen} aria-label="Landing navigation">
      <button type="button" onclick={() => scrollToSection('features')}>Features</button>
      <button type="button" onclick={() => scrollToSection('showcase')}>Preview</button>
      <button type="button" onclick={() => scrollToSection('downloads')}>Downloads</button>
      <a href="/legal/privacy">Privacy</a>
    </nav>
    <a class="header-cta" href="/app">Open NEXA <span>↗</span></a>
  </header>

  <main>
    <section class="hero">
      <div class="hero-copy" data-reveal>
        <div class="hero-kicker"><span></span> One app. Every conversation.</div>
        <h1>
          Find your people.<br />
          <em>Stay for everything.</em>
        </h1>
        <p class="hero-lead">
          Communities, private messages, social posts, and voice rooms in one fast, focused space.
          No trackers. No clutter. No heavyweight client.
        </p>
        <div class="hero-actions">
          <a class="download-primary" href={primaryDownload.href}>
            <span class="button-icon">{primaryDownload.icon}</span>
            <span><small>RECOMMENDED FOR YOU</small>{primaryDownload.label}</span>
            <b>↓</b>
          </a>
          <a class="browser-button" href="/app">Continue in browser <span>→</span></a>
        </div>
        <div class="trust-line">
          <span><i>✓</i> Free & open source</span>
          <span><i>✓</i> Lightweight</span>
          <span><i>✓</i> Privacy first</span>
        </div>
      </div>

      <div class="hero-visual" data-reveal>
        <div class="float-pill pill-one"><span>●</span> 12 friends online</div>
        <div class="float-pill pill-two"><span>✦</span> New community</div>
        <div class="float-pill pill-three"><span>◖</span> Voice connected</div>
        <div class="visual-glow"></div>
        <div class="app-window">
          <div class="window-bar">
            <div class="window-dots"><i></i><i></i><i></i></div>
            <div class="window-address"><span>◆</span> nexa.app</div>
            <span class="window-live">● LIVE</span>
          </div>
          <div class="video-wrap">
            <video
              bind:this={promoVideo}
              autoplay
              muted
              loop
              playsinline
              preload="metadata"
              poster="/images/nexa-community.png"
              aria-label="NEXA product preview"
              onloadedmetadata={startPromoAfterIntro}
            >
              <source src="/media/nexa-preview.webm" type="video/webm" />
            </video>
            <button
              class="video-control"
              type="button"
              onclick={toggleVideo}
              aria-label={videoPaused ? 'Play preview' : 'Pause preview'}
            >
              {videoPaused ? '▶' : 'Ⅱ'}
            </button>
            <div class="video-caption"><span></span> REAL PRODUCT PREVIEW</div>
          </div>
        </div>
      </div>

      <div class="hero-scroll" aria-hidden="true"><span></span> Explore NEXA</div>
    </section>

    <section class="ticker" aria-label="NEXA capabilities">
      <div class="ticker-track">
        {#each Array(2) as _}
          <span
            >COMMUNITIES <b>✦</b> PRIVATE CHAT <b>✦</b> SOCIAL FEED <b>✦</b> VOICE ROOMS <b>✦</b>
            ZERO TRACKERS <b>✦</b> LOW-POWER MODE <b>✦</b></span
          >
        {/each}
      </div>
    </section>

    <section class="feature-section" id="features">
      <div class="section-heading" data-reveal>
        <p>EVERYTHING, WITHOUT THE NOISE</p>
        <h2>Built around people,<br /><em>not algorithms.</em></h2>
        <span
          >NEXA keeps your communities and conversations close, while staying fast enough for every
          device.</span
        >
      </div>

      <div class="feature-grid">
        <article class="feature-card community-card" data-reveal>
          <div class="feature-top">
            <span class="feature-number">01</span><span class="feature-icon">◈</span>
          </div>
          <h3>Communities that feel alive</h3>
          <p>
            Channels, roles, threads, reactions, moderation, and voice — organized without getting
            in your way.
          </p>
          <div class="mini-community" aria-hidden="true">
            <div class="mini-rail"><i>N</i><i>CR</i><i>DV</i><i>＋</i></div>
            <div class="mini-channels">
              <b>CREATORS</b><span class="active"># general</span><span># inspiration</span><span
                >◖ studio-live</span
              >
            </div>
            <div class="mini-chat">
              <strong>What are you building?</strong><span
                ><i>AS</i><b>Amira</b> Just shipped the new landing page ✨</span
              ><span><i>MK</i><b>Malik</b> The motion looks so clean.</span>
            </div>
          </div>
        </article>

        <article class="feature-card message-card" data-reveal>
          <div class="feature-top">
            <span class="feature-number">02</span><span class="feature-icon">✉</span>
          </div>
          <h3>Private by default</h3>
          <p>
            Fast one-to-one and group chats with replies, reactions, voice notes, files, and read
            receipts.
          </p>
          <div class="floating-messages" aria-hidden="true">
            <div class="bubble bubble-left">
              <span>Hey — voice room in five?</span><small>8:42 PM</small>
            </div>
            <div class="bubble bubble-right">
              <span>Already there 🎧</span><small>8:43 PM · Read</small>
            </div>
            <div class="typing-bubble"><i></i><i></i><i></i></div>
          </div>
        </article>

        <article class="feature-card power-card" data-reveal>
          <div class="feature-top">
            <span class="feature-number">03</span><span class="feature-icon">⌁</span>
          </div>
          <h3>Light on every device</h3>
          <p>
            A tiny Svelte interface, Tauri desktop shell, low-power controls, and no polling loops.
          </p>
          <div class="speed-meter" aria-label="NEXA performance score 100">
            <div class="speed-ring"><strong>100</strong><span>PERFORMANCE</span></div>
            <ul>
              <li><span>Initial JS</span><b>61 KB</b></li>
              <li><span>Lighthouse</span><b>100</b></li>
              <li><span>Idle polling</span><b>None</b></li>
            </ul>
          </div>
        </article>
      </div>
    </section>

    <section class="showcase" id="showcase">
      <div class="showcase-copy" data-reveal>
        <p class="section-label">DESIGNED TO DISAPPEAR</p>
        <h2>Your space.<br /><em>Your pace.</em></h2>
        <p>Dark by default, accessible by design, and calm enough to keep open all day.</p>
        <ul>
          <li>
            <span>01</span>
            <div>
              <strong>Realtime, not restless</strong><small
                >WebSockets wake only when something happens.</small
              >
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Low-power when you need it</strong><small
                >Pause motion, media loading, and frequent heartbeats.</small
              >
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>English and Arabic</strong><small
                >Full right-to-left layout is built in.</small
              >
            </div>
          </li>
        </ul>
      </div>
      <div class="showcase-images" data-reveal>
        <div class="image-card image-main">
          <img
            src="/images/nexa-community.png"
            alt="NEXA community chat interface"
            loading="lazy"
          /><span>COMMUNITIES</span>
        </div>
        <div class="image-card image-secondary">
          <img src="/images/nexa-auth.png" alt="NEXA sign-in screen" loading="lazy" /><span
            >WELCOME HOME</span
          >
        </div>
        <div class="image-badge"><strong>0</strong><small>TRACKERS</small></div>
      </div>
    </section>

    <section class="download-section" id="downloads">
      <div class="download-heading" data-reveal>
        <p>TAKE NEXA WITH YOU</p>
        <h2>One account.<br /><em>Everywhere.</em></h2>
      </div>
      <div class="platform-grid">
        <a
          class="platform-card"
          class:recommended={platform === 'windows'}
          href={windowsDownload}
          data-reveal
        >
          {#if platform === 'windows'}<span class="recommended-tag">RECOMMENDED</span>{/if}
          <div class="platform-icon windows-icon">⊞</div>
          <div>
            <small>WINDOWS 10 & 11</small>
            <h3>Desktop app</h3>
            <p>Native Tauri performance, system notifications, and automatic signed updates.</p>
          </div>
          <span class="platform-action">Download installer <b>↓</b></span>
        </a>
        <a
          class="platform-card"
          class:recommended={platform === 'android'}
          href={androidDownload}
          data-reveal
        >
          {#if platform === 'android'}<span class="recommended-tag">RECOMMENDED</span>{/if}
          <div class="platform-icon android-icon">◆</div>
          <div>
            <small>ANDROID 8+</small>
            <h3>Android APK</h3>
            <p>The complete NEXA experience, wrapped in a lightweight native Android shell.</p>
          </div>
          <span class="platform-action">Download APK <b>↓</b></span>
        </a>
        <a
          class="platform-card web-card"
          class:recommended={platform === 'web'}
          href="/app"
          data-reveal
        >
          {#if platform === 'web'}<span class="recommended-tag">RECOMMENDED</span>{/if}
          <div class="platform-icon web-icon">◎</div>
          <div>
            <small>ANY MODERN BROWSER</small>
            <h3>Continue on web</h3>
            <p>No installation. Sign in securely and get the full app right here.</p>
          </div>
          <span class="platform-action">Open browser app <b>→</b></span>
        </a>
      </div>
      <p class="release-note">
        Free and open source · Signed release artifacts · No advertising SDKs
      </p>
    </section>

    <section class="final-cta" data-reveal>
      <div class="cta-orbit orbit-a" aria-hidden="true"></div>
      <div class="cta-orbit orbit-b" aria-hidden="true"></div>
      <span class="cta-mark">N</span>
      <p>YOUR PEOPLE ARE WAITING</p>
      <h2>Make the internet<br /><em>feel close again.</em></h2>
      <div>
        <a class="download-primary compact" href={primaryDownload.href}
          >{primaryDownload.label} <b>↓</b></a
        ><a class="text-link" href="/app">or continue in browser →</a>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-brand">
      <span class="brand-glyph">N</span>
      <div><strong>NEXA</strong><small>Your people. One place.</small></div>
    </div>
    <div class="footer-links">
      <div>
        <b>PRODUCT</b><button onclick={() => scrollToSection('features')}>Features</button><button
          onclick={() => scrollToSection('downloads')}>Downloads</button
        ><a href="/app">Browser app</a>
      </div>
      <div>
        <b>TRUST</b><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a
          href={releasePage}>Source & releases</a
        >
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 NEXA contributors · MIT licensed</span><span class="status"
        ><i></i> Built to be yours</span
      >
    </div>
  </footer>
</div>

<style>
  :global(html.landing-active),
  :global(body.landing-active) {
    overflow-x: hidden;
    overflow-y: auto;
    scroll-behavior: smooth;
    background: #08080c;
  }
  :global(body.landing-active) {
    min-height: 100%;
  }
  .landing-shell {
    --landing-bg: #08080c;
    --landing-panel: #111118;
    --landing-text: #f6f2ff;
    --landing-muted: #aaa5b7;
    --violet: #8b5cf6;
    --violet-bright: #a78bfa;
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background: var(--landing-bg);
    color: var(--landing-text);
    isolation: isolate;
  }
  .noise {
    position: fixed;
    z-index: 20;
    pointer-events: none;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.9'/%3E%3C/svg%3E");
    inset: 0;
  }
  .orb {
    position: absolute;
    z-index: -1;
    border-radius: 50%;
    filter: blur(1px);
    pointer-events: none;
  }
  .orb-one {
    width: 720px;
    height: 720px;
    background: radial-gradient(circle, rgb(109 40 217 / 0.28), transparent 68%);
    inset: -270px auto auto -240px;
    animation: orbit-drift 16s ease-in-out infinite alternate;
  }
  .orb-two {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgb(79 70 229 / 0.2), transparent 70%);
    inset: 180px -250px auto auto;
    animation: orbit-drift 19s ease-in-out -5s infinite alternate-reverse;
  }
  .orb-three {
    width: 480px;
    height: 480px;
    background: radial-gradient(circle, rgb(139 92 246 / 0.12), transparent 72%);
    inset: 1300px auto auto 15%;
    animation: orbit-drift 22s ease-in-out -9s infinite alternate;
  }
  .site-header {
    position: absolute;
    z-index: 30;
    display: grid;
    width: min(1380px, calc(100% - 56px));
    height: 82px;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    border-block-end: 1px solid rgb(255 255 255 / 0.09);
    inset: 0 0 auto;
    margin: auto;
  }
  .landing-brand {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 11px;
    color: white;
    font-size: 1.02rem;
    letter-spacing: 0.2em;
  }
  .landing-brand:hover {
    text-decoration: none;
  }
  .brand-glyph {
    display: grid;
    width: 39px;
    height: 39px;
    place-items: center;
    border-radius: 12px;
    background: linear-gradient(135deg, #a78bfa, #6d28d9);
    color: white;
    font-weight: 900;
    letter-spacing: 0;
    box-shadow: 0 12px 30px rgb(109 40 217 / 0.3);
  }
  nav {
    display: flex;
    align-items: center;
    gap: 33px;
  }
  nav button,
  nav a {
    padding: 5px 0;
    background: transparent;
    color: #aca6b8;
    font-size: 0.76rem;
    font-weight: 700;
  }
  nav button:hover,
  nav a:hover {
    color: white;
    text-decoration: none;
  }
  .header-cta {
    display: inline-flex;
    min-height: 39px;
    align-items: center;
    gap: 16px;
    justify-self: end;
    padding: 0 16px;
    border: 1px solid rgb(167 139 250 / 0.35);
    border-radius: 9px;
    background: rgb(139 92 246 / 0.08);
    color: #ddd2ff;
    font-size: 0.74rem;
    font-weight: 800;
  }
  .header-cta:hover {
    background: rgb(139 92 246 / 0.16);
    text-decoration: none;
  }
  .menu-toggle {
    display: none;
  }
  .hero {
    position: relative;
    display: grid;
    min-height: 820px;
    grid-template-columns: minmax(380px, 0.85fr) minmax(540px, 1.15fr);
    align-items: center;
    gap: clamp(30px, 5vw, 90px);
    padding: 125px max(28px, calc((100% - 1380px) / 2)) 75px;
  }
  .hero-copy {
    position: relative;
    z-index: 3;
    padding-inline-start: 8px;
  }
  .hero-kicker,
  .section-label {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 22px;
    color: #b9a8ed;
    font-size: 0.68rem;
    font-weight: 850;
    letter-spacing: 0.18em;
  }
  .hero-kicker span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #8b5cf6;
    box-shadow: 0 0 15px #8b5cf6;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  h1 {
    margin: 0;
    font-size: clamp(3.65rem, 6.2vw, 7.35rem);
    font-weight: 830;
    letter-spacing: -0.075em;
    line-height: 0.91;
  }
  h1 em,
  h2 em {
    color: transparent;
    font-style: normal;
    background: linear-gradient(105deg, #a78bfa 5%, #7c3aed 58%, #c4b5fd);
    background-clip: text;
    -webkit-background-clip: text;
  }
  .hero-lead {
    max-width: 590px;
    margin: 30px 0 31px;
    color: #aaa5b7;
    font-size: clamp(0.97rem, 1.35vw, 1.12rem);
    line-height: 1.75;
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 13px;
  }
  .download-primary {
    display: flex;
    min-width: 285px;
    min-height: 65px;
    align-items: center;
    gap: 13px;
    padding: 8px 16px;
    border-radius: 12px;
    background: linear-gradient(120deg, #7c3aed, #8b5cf6);
    color: white;
    box-shadow:
      0 17px 45px rgb(109 40 217 / 0.32),
      inset 0 1px rgb(255 255 255 / 0.22);
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }
  .download-primary:hover {
    transform: translateY(-3px);
    box-shadow:
      0 22px 60px rgb(109 40 217 / 0.45),
      inset 0 1px rgb(255 255 255 / 0.25);
    text-decoration: none;
  }
  .download-primary > span:nth-child(2) {
    display: grid;
    flex: 1;
    font-size: 0.9rem;
    font-weight: 800;
  }
  .download-primary small {
    opacity: 0.7;
    font-size: 0.55rem;
    letter-spacing: 0.13em;
  }
  .download-primary b {
    font-size: 1.1rem;
  }
  .button-icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.12);
    font-size: 1.2rem;
  }
  .browser-button {
    display: inline-flex;
    min-height: 60px;
    align-items: center;
    gap: 25px;
    padding: 0 20px;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 11px;
    background: rgb(255 255 255 / 0.035);
    color: #d7d2df;
    font-size: 0.8rem;
    font-weight: 750;
  }
  .browser-button:hover {
    border-color: rgb(167 139 250 / 0.4);
    background: rgb(139 92 246 / 0.06);
    color: white;
    text-decoration: none;
  }
  .trust-line {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-top: 25px;
    color: #8f8997;
    font-size: 0.67rem;
  }
  .trust-line i {
    color: #8b5cf6;
    font-style: normal;
  }
  .hero-visual {
    position: relative;
    z-index: 2;
    perspective: 1300px;
    transform: translate(calc(var(--pointer-x, 0) * -7px), calc(var(--pointer-y, 0) * -7px));
    transition: transform 0.15s linear;
  }
  .visual-glow {
    position: absolute;
    z-index: -1;
    border-radius: 50%;
    background: #7c3aed;
    filter: blur(110px);
    opacity: 0.18;
    inset: 12% 10%;
  }
  .app-window {
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.14);
    border-radius: 17px;
    background: #111118;
    box-shadow:
      0 55px 100px rgb(0 0 0 / 0.55),
      0 0 0 1px rgb(139 92 246 / 0.07);
    transform: rotateY(calc(var(--pointer-x, 0) * 2deg)) rotateX(calc(var(--pointer-y, 0) * -2deg));
    transition: transform 0.15s linear;
  }
  .window-bar {
    display: grid;
    height: 49px;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 14px;
    border-block-end: 1px solid #292832;
    background: #17171f;
  }
  .window-dots {
    display: flex;
    gap: 5px;
  }
  .window-dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4c4956;
  }
  .window-address {
    min-width: 170px;
    padding: 5px 18px;
    border: 1px solid #2d2b36;
    border-radius: 7px;
    background: #111117;
    color: #918b99;
    font-size: 0.58rem;
    text-align: center;
  }
  .window-address span {
    margin-inline-end: 6px;
    color: #8b5cf6;
  }
  .window-live {
    justify-self: end;
    color: #34d399;
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.1em;
  }
  .video-wrap {
    position: relative;
    aspect-ratio: 16/9;
    overflow: hidden;
    background: #0d0d12;
  }
  .video-wrap video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .video-wrap::after {
    position: absolute;
    pointer-events: none;
    background: linear-gradient(180deg, transparent 62%, rgb(5 5 9 / 0.52));
    content: '';
    inset: 0;
  }
  .video-control {
    position: absolute;
    z-index: 3;
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: 50%;
    background: rgb(8 8 12 / 0.68);
    color: white;
    inset-inline-end: 15px;
    inset-block-end: 14px;
    backdrop-filter: blur(10px);
  }
  .video-caption {
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 7px;
    color: rgb(255 255 255 / 0.62);
    font-size: 0.53rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    inset-inline-start: 17px;
    inset-block-end: 17px;
  }
  .video-caption span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f43f5e;
    box-shadow: 0 0 9px #f43f5e;
  }
  .float-pill {
    position: absolute;
    z-index: 5;
    padding: 9px 12px;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 10px;
    background: rgb(20 19 27 / 0.8);
    color: #c8c2d1;
    font-size: 0.62rem;
    font-weight: 700;
    box-shadow: 0 14px 32px rgb(0 0 0 / 0.3);
    backdrop-filter: blur(12px);
    animation: float 4.5s ease-in-out infinite;
  }
  .float-pill span {
    margin-inline-end: 5px;
    color: #a78bfa;
  }
  .pill-one {
    inset: -28px auto auto 8%;
    animation-delay: -0.5s;
  }
  .pill-two {
    inset: 22% -28px auto auto;
    animation-delay: -2.1s;
  }
  .pill-three {
    inset: auto auto -24px 23%;
    animation-delay: -3.3s;
  }
  .hero-scroll {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #918b99;
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    inset: auto auto 23px 50%;
    transform: translateX(-50%);
  }
  .hero-scroll span {
    position: relative;
    width: 1px;
    height: 26px;
    overflow: hidden;
    background: #35323b;
  }
  .hero-scroll span::after {
    position: absolute;
    width: 1px;
    height: 10px;
    background: #a78bfa;
    content: '';
    inset: -10px 0 auto;
    animation: scroll-line 1.8s ease-in-out infinite;
  }
  .ticker {
    overflow: hidden;
    border-block: 1px solid rgb(255 255 255 / 0.075);
    background: #0d0d12;
    transform: rotate(-1deg) scale(1.02);
  }
  .ticker-track {
    display: flex;
    width: max-content;
    padding: 14px 0;
    animation: ticker 32s linear infinite;
  }
  .ticker-track span {
    color: #918b99;
    font-size: 0.58rem;
    font-weight: 850;
    letter-spacing: 0.19em;
    white-space: nowrap;
  }
  .ticker-track b {
    padding: 0 24px;
    color: #7c3aed;
  }
  .feature-section {
    padding: 145px max(24px, calc((100% - 1280px) / 2));
  }
  .section-heading {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    align-items: end;
    margin-bottom: 60px;
  }
  .section-heading p,
  .download-heading p {
    grid-column: 1/-1;
    margin: 0 0 16px;
    color: #9f8ed5;
    font-size: 0.62rem;
    font-weight: 850;
    letter-spacing: 0.2em;
  }
  .section-heading h2,
  .showcase h2,
  .download-heading h2,
  .final-cta h2 {
    margin: 0;
    font-size: clamp(2.5rem, 4.5vw, 5rem);
    letter-spacing: -0.06em;
    line-height: 0.96;
  }
  .section-heading > span {
    max-width: 430px;
    justify-self: end;
    color: #8f8998;
    font-size: 0.88rem;
    line-height: 1.7;
  }
  .feature-grid {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 14px;
  }
  .feature-card {
    position: relative;
    min-height: 440px;
    overflow: hidden;
    padding: 30px;
    border: 1px solid rgb(255 255 255 / 0.09);
    border-radius: 19px;
    background: linear-gradient(145deg, #121219, #0e0e14);
  }
  .feature-card::before {
    position: absolute;
    pointer-events: none;
    background: radial-gradient(circle at 100% 0%, rgb(124 58 237 / 0.14), transparent 45%);
    content: '';
    inset: 0;
  }
  .feature-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .feature-number {
    color: #57525f;
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.15em;
  }
  .feature-icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgb(139 92 246 / 0.23);
    border-radius: 12px;
    background: rgb(139 92 246 / 0.09);
    color: #a78bfa;
    font-size: 1.2rem;
  }
  .feature-card h3 {
    position: relative;
    margin: 38px 0 9px;
    font-size: 1.35rem;
    letter-spacing: -0.035em;
  }
  .feature-card > p {
    position: relative;
    max-width: 550px;
    margin: 0;
    color: #85808e;
    font-size: 0.81rem;
    line-height: 1.65;
  }
  .community-card {
    grid-row: span 2;
  }
  .mini-community {
    position: absolute;
    display: grid;
    height: 225px;
    grid-template-columns: 50px 130px 1fr;
    overflow: hidden;
    border: 1px solid #2b2933;
    border-radius: 12px 12px 0 0;
    background: #14141b;
    inset: auto 28px 0;
    transform: perspective(800px) rotateX(2deg);
    transform-origin: bottom;
  }
  .mini-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 7px;
    border-inline-end: 1px solid #292731;
    background: #0d0d12;
  }
  .mini-rail i {
    display: grid;
    width: 31px;
    height: 31px;
    place-items: center;
    border-radius: 10px;
    background: #24222b;
    color: #aaa3b3;
    font-size: 0.5rem;
    font-style: normal;
    font-weight: 800;
  }
  .mini-rail i:first-child {
    background: #7c3aed;
    color: white;
  }
  .mini-channels {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 15px 10px;
    border-inline-end: 1px solid #292731;
    background: #111117;
  }
  .mini-channels b {
    margin-bottom: 5px;
    color: #6f6976;
    font-size: 0.46rem;
    letter-spacing: 0.12em;
  }
  .mini-channels span {
    padding: 6px 7px;
    border-radius: 5px;
    color: #77717e;
    font-size: 0.53rem;
  }
  .mini-channels span.active {
    background: rgb(124 58 237 / 0.2);
    color: #c4b5fd;
  }
  .mini-chat {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 10px;
    padding: 17px;
  }
  .mini-chat > strong {
    padding-bottom: 10px;
    border-bottom: 1px solid #282630;
    font-size: 0.62rem;
  }
  .mini-chat > span {
    display: grid;
    grid-template-columns: 25px 1fr;
    align-items: center;
    color: #827c89;
    font-size: 0.5rem;
  }
  .mini-chat i {
    display: grid;
    width: 22px;
    height: 22px;
    grid-row: span 2;
    place-items: center;
    border-radius: 50%;
    background: #6d28d9;
    color: white;
    font-size: 0.43rem;
    font-style: normal;
  }
  .mini-chat b {
    color: #cac4d2;
    font-size: 0.53rem;
  }
  .message-card {
    min-height: 345px;
  }
  .floating-messages {
    position: absolute;
    display: grid;
    gap: 10px;
    inset: auto 25px 25px;
  }
  .bubble {
    width: fit-content;
    max-width: 86%;
    padding: 9px 12px;
    border-radius: 12px;
    color: #cfc9d6;
    font-size: 0.67rem;
    box-shadow: 0 9px 20px rgb(0 0 0 / 0.2);
    animation: message-float 5s ease-in-out infinite;
  }
  .bubble small {
    display: block;
    margin-top: 3px;
    color: #716b77;
    font-size: 0.48rem;
  }
  .bubble-left {
    border-end-start-radius: 4px;
    background: #23212b;
  }
  .bubble-right {
    justify-self: end;
    border-end-end-radius: 4px;
    background: linear-gradient(120deg, #6d28d9, #7c3aed);
    color: white;
    animation-delay: -2.5s;
  }
  .bubble-right small {
    color: rgb(255 255 255 / 0.65);
  }
  .typing-bubble {
    display: flex;
    width: fit-content;
    gap: 3px;
    padding: 8px 11px;
    border-radius: 12px;
    background: #23212b;
  }
  .typing-bubble i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #8d8794;
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing-bubble i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing-bubble i:nth-child(3) {
    animation-delay: 0.4s;
  }
  .power-card {
    min-height: 345px;
  }
  .speed-meter {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 23px;
    inset: auto 28px 24px;
  }
  .speed-ring {
    display: grid;
    width: 105px;
    height: 105px;
    place-content: center;
    border: 4px solid #2d2935;
    border-block-start-color: #8b5cf6;
    border-inline-end-color: #8b5cf6;
    border-radius: 50%;
    text-align: center;
    transform: rotate(8deg);
  }
  .speed-ring strong,
  .speed-ring span {
    transform: rotate(-8deg);
  }
  .speed-ring strong {
    font-size: 1.8rem;
  }
  .speed-ring span {
    color: #756e7b;
    font-size: 0.42rem;
    letter-spacing: 0.08em;
  }
  .speed-meter ul {
    display: grid;
    min-width: 130px;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .speed-meter li {
    display: flex;
    gap: 15px;
    padding-bottom: 6px;
    border-bottom: 1px solid #292731;
    color: #797380;
    font-size: 0.55rem;
  }
  .speed-meter li span {
    flex: 1;
  }
  .speed-meter li b {
    color: #b8b1c0;
  }
  .showcase {
    display: grid;
    min-height: 760px;
    grid-template-columns: 0.75fr 1.25fr;
    align-items: center;
    gap: 80px;
    padding: 110px max(24px, calc((100% - 1280px) / 2));
    border-block: 1px solid rgb(255 255 255 / 0.07);
    background:
      radial-gradient(circle at 75% 50%, rgb(109 40 217 / 0.12), transparent 40%), #0b0b10;
  }
  .showcase-copy > p:not(.section-label) {
    max-width: 400px;
    color: #8c8693;
    font-size: 0.85rem;
    line-height: 1.7;
  }
  .showcase-copy ul {
    display: grid;
    gap: 0;
    margin: 40px 0 0;
    padding: 0;
    list-style: none;
  }
  .showcase-copy li {
    display: flex;
    gap: 15px;
    padding: 16px 0;
    border-block-start: 1px solid #27252e;
  }
  .showcase-copy li > span {
    color: #706978;
    font-size: 0.52rem;
    font-weight: 800;
  }
  .showcase-copy li strong,
  .showcase-copy li small {
    display: block;
  }
  .showcase-copy li strong {
    font-size: 0.77rem;
  }
  .showcase-copy li small {
    margin-top: 3px;
    color: #76717c;
    font-size: 0.63rem;
  }
  .showcase-images {
    position: relative;
    min-height: 500px;
    perspective: 1200px;
  }
  .image-card {
    position: absolute;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 14px;
    background: #14141b;
    box-shadow: 0 40px 80px rgb(0 0 0 / 0.48);
  }
  .image-card img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .image-card span {
    position: absolute;
    padding: 6px 9px;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 7px;
    background: rgb(8 8 12 / 0.7);
    color: #c4b5fd;
    font-size: 0.48rem;
    font-weight: 850;
    letter-spacing: 0.15em;
    inset: 12px auto auto 12px;
    backdrop-filter: blur(8px);
  }
  .image-main {
    width: 83%;
    aspect-ratio: 16/9;
    inset: 20px 0 auto auto;
    transform: rotateY(-5deg) translateY(calc(var(--pointer-y, 0) * 7px));
  }
  .image-secondary {
    width: 47%;
    aspect-ratio: 16/9;
    inset: auto auto 10px 0;
    transform: rotateY(7deg) translateY(calc(var(--pointer-y, 0) * -9px));
  }
  .image-badge {
    position: absolute;
    z-index: 3;
    display: grid;
    width: 92px;
    height: 92px;
    place-content: center;
    border: 1px solid rgb(167 139 250 / 0.25);
    border-radius: 50%;
    background: rgb(18 17 25 / 0.82);
    color: white;
    text-align: center;
    box-shadow: 0 18px 45px rgb(0 0 0 / 0.4);
    inset: auto 8% 8%;
    backdrop-filter: blur(12px);
    animation: float 5s ease-in-out infinite;
  }
  .image-badge strong {
    font-size: 1.7rem;
  }
  .image-badge small {
    color: #a78bfa;
    font-size: 0.46rem;
    letter-spacing: 0.13em;
  }
  .download-section {
    padding: 145px max(24px, calc((100% - 1280px) / 2));
  }
  .download-heading {
    margin-bottom: 58px;
    text-align: center;
  }
  .platform-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .platform-card {
    position: relative;
    display: flex;
    min-height: 390px;
    flex-direction: column;
    gap: 25px;
    padding: 29px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.09);
    border-radius: 18px;
    background: linear-gradient(150deg, #121219, #0e0e14);
    color: var(--landing-text);
    transition:
      transform 0.25s ease,
      border-color 0.25s ease,
      background 0.25s ease;
  }
  .platform-card::after {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: rgb(124 58 237 / 0.08);
    filter: blur(40px);
    content: '';
    inset: -170px -130px auto auto;
  }
  .platform-card:hover,
  .platform-card.recommended {
    border-color: rgb(139 92 246 / 0.4);
    background: linear-gradient(150deg, #181424, #0f0e17);
    transform: translateY(-7px);
    text-decoration: none;
  }
  .recommended-tag {
    position: absolute;
    padding: 5px 8px;
    border-radius: 0 0 0 8px;
    background: #7c3aed;
    color: white;
    font-size: 0.45rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    inset: 0 0 auto auto;
  }
  .platform-icon {
    position: relative;
    z-index: 1;
    display: grid;
    width: 62px;
    height: 62px;
    place-items: center;
    border-radius: 18px;
    font-size: 1.8rem;
  }
  .windows-icon {
    background: rgb(96 165 250 / 0.12);
    color: #60a5fa;
  }
  .android-icon {
    background: rgb(52 211 153 / 0.12);
    color: #34d399;
  }
  .web-icon {
    background: rgb(167 139 250 / 0.12);
    color: #a78bfa;
  }
  .platform-card > div:nth-of-type(2) {
    flex: 1;
  }
  .platform-card small {
    color: #79727f;
    font-size: 0.52rem;
    font-weight: 850;
    letter-spacing: 0.14em;
  }
  .platform-card h3 {
    margin: 10px 0 8px;
    font-size: 1.35rem;
  }
  .platform-card p {
    color: #827c88;
    font-size: 0.76rem;
    line-height: 1.65;
  }
  .platform-action {
    display: flex;
    align-items: center;
    padding-top: 17px;
    border-block-start: 1px solid #2a2831;
    color: #aaa3b2;
    font-size: 0.7rem;
    font-weight: 750;
  }
  .platform-action b {
    margin-inline-start: auto;
    color: #a78bfa;
    font-size: 1rem;
  }
  .release-note {
    margin: 27px 0 0;
    color: #918b99;
    font-size: 0.6rem;
    text-align: center;
  }
  .final-cta {
    position: relative;
    display: grid;
    min-height: 650px;
    overflow: hidden;
    place-content: center;
    justify-items: center;
    padding: 80px 24px;
    border-block: 1px solid rgb(255 255 255 / 0.08);
    background:
      radial-gradient(circle at 50% 55%, rgb(109 40 217 / 0.22), transparent 38%), #0b0b10;
    text-align: center;
  }
  .cta-mark {
    display: grid;
    width: 58px;
    height: 58px;
    margin-bottom: 24px;
    place-items: center;
    border-radius: 17px;
    background: linear-gradient(135deg, #a78bfa, #6d28d9);
    color: white;
    font-size: 1.35rem;
    font-weight: 900;
    box-shadow: 0 17px 45px rgb(109 40 217 / 0.4);
    animation: float 5s ease-in-out infinite;
  }
  .final-cta > p {
    color: #9e8cd4;
    font-size: 0.58rem;
    font-weight: 850;
    letter-spacing: 0.22em;
  }
  .final-cta h2 {
    position: relative;
    z-index: 2;
  }
  .final-cta > div:not(.cta-orbit) {
    display: flex;
    align-items: center;
    gap: 22px;
    margin-top: 34px;
  }
  .download-primary.compact {
    min-width: 230px;
    min-height: 52px;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 800;
  }
  .text-link {
    color: #aaa4b2;
    font-size: 0.72rem;
  }
  .cta-orbit {
    position: absolute;
    border: 1px solid rgb(139 92 246 / 0.11);
    border-radius: 50%;
    pointer-events: none;
  }
  .orbit-a {
    width: 470px;
    height: 470px;
    animation: spin 22s linear infinite;
  }
  .orbit-a::before {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8b5cf6;
    box-shadow: 0 0 15px #8b5cf6;
    content: '';
    inset: 20% 3% auto auto;
  }
  .orbit-b {
    width: 680px;
    height: 680px;
    border-style: dashed;
    animation: spin 45s linear infinite reverse;
  }
  footer {
    padding: 70px max(24px, calc((100% - 1280px) / 2)) 28px;
    background: #08080c;
  }
  .footer-brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .footer-brand strong,
  .footer-brand small {
    display: block;
  }
  .footer-brand strong {
    letter-spacing: 0.18em;
  }
  .footer-brand small {
    margin-top: 3px;
    color: #918b99;
    font-size: 0.57rem;
  }
  .footer-links {
    display: grid;
    grid-template-columns: 1fr 1fr;
    max-width: 380px;
    gap: 50px;
    margin: 55px 0 60px auto;
  }
  .footer-links > div {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .footer-links b {
    margin-bottom: 6px;
    color: #918b99;
    font-size: 0.5rem;
    letter-spacing: 0.16em;
  }
  .footer-links a,
  .footer-links button {
    width: fit-content;
    padding: 0;
    background: transparent;
    color: #aaa3b0;
    font-size: 0.67rem;
  }
  .footer-bottom {
    display: flex;
    justify-content: space-between;
    padding-top: 23px;
    border-block-start: 1px solid #24222a;
    color: #918b99;
    font-size: 0.55rem;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 8px #34d399;
  }
  [data-reveal] {
    opacity: 0;
    transform: translateY(28px);
    transition:
      opacity 0.8s ease,
      transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  [data-reveal]:global(.is-visible) {
    opacity: 1;
    transform: translateY(0);
  }
  .feature-card:nth-child(2),
  .platform-card:nth-child(2) {
    transition-delay: 0.1s;
  }
  .feature-card:nth-child(3),
  .platform-card:nth-child(3) {
    transition-delay: 0.2s;
  }
  @keyframes orbit-drift {
    to {
      transform: translate(55px, 35px) scale(1.08);
    }
  }
  @keyframes float {
    50% {
      transform: translateY(-9px);
    }
  }
  @keyframes message-float {
    50% {
      transform: translateY(-4px);
    }
  }
  @keyframes pulse-dot {
    50% {
      opacity: 0.35;
      transform: scale(0.75);
    }
  }
  @keyframes typing {
    50% {
      opacity: 0.3;
      transform: translateY(-2px);
    }
  }
  @keyframes scroll-line {
    to {
      transform: translateY(46px);
    }
  }
  @keyframes ticker {
    to {
      transform: translateX(-50%);
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 1050px) {
    .site-header {
      grid-template-columns: 1fr 1fr;
    }
    .site-header nav {
      display: none;
    }
    .hero {
      min-height: auto;
      grid-template-columns: 1fr;
      padding-top: 155px;
    }
    .hero-copy {
      max-width: 760px;
    }
    .hero-visual {
      width: min(820px, 94%);
      margin: 45px auto 35px;
    }
    .hero-scroll {
      display: none;
    }
    .feature-grid {
      grid-template-columns: 1fr 1fr;
    }
    .community-card {
      grid-column: 1/-1;
      grid-row: auto;
      min-height: 560px;
    }
    .showcase {
      grid-template-columns: 1fr;
    }
    .showcase-copy {
      max-width: 550px;
    }
    .showcase-images {
      width: min(850px, 100%);
    }
  }
  @media (max-width: 760px) {
    .site-header {
      width: calc(100% - 32px);
      height: 70px;
    }
    .header-cta {
      display: none;
    }
    .menu-toggle {
      position: relative;
      display: block;
      width: 42px;
      height: 42px;
      justify-self: end;
      border-radius: 10px;
      background: #17171e;
    }
    .menu-toggle i {
      position: absolute;
      width: 17px;
      height: 1px;
      background: white;
      inset-inline-start: 12px;
      inset-block-start: 17px;
      transition: transform 0.2s;
    }
    .menu-toggle i:last-child {
      inset-block-start: 24px;
    }
    .menu-toggle.active i:first-child {
      transform: translateY(3px) rotate(45deg);
    }
    .menu-toggle.active i:last-child {
      transform: translateY(-4px) rotate(-45deg);
    }
    .site-header nav.open {
      position: absolute;
      display: flex;
      align-items: stretch;
      gap: 0;
      padding: 10px;
      border: 1px solid #292732;
      border-radius: 12px;
      background: rgb(15 15 21 / 0.96);
      inset: 62px 0 auto;
      flex-direction: column;
      box-shadow: 0 25px 60px rgb(0 0 0 / 0.45);
      backdrop-filter: blur(14px);
    }
    .site-header nav.open a,
    .site-header nav.open button {
      padding: 12px;
      text-align: start;
    }
    .hero {
      display: block;
      padding: 125px 18px 70px;
    }
    h1 {
      font-size: clamp(3.1rem, 16vw, 5.5rem);
    }
    .hero-lead {
      font-size: 0.91rem;
    }
    .hero-actions {
      align-items: stretch;
      flex-direction: column;
    }
    .download-primary,
    .browser-button {
      width: 100%;
    }
    .browser-button {
      justify-content: center;
    }
    .trust-line {
      gap: 10px 15px;
    }
    .hero-visual {
      width: 100%;
      margin-top: 58px;
    }
    .float-pill {
      font-size: 0.48rem;
    }
    .pill-one {
      inset-block-start: -35px;
    }
    .pill-two {
      inset-inline-end: -8px;
    }
    .pill-three {
      inset-block-end: -31px;
    }
    .window-address {
      min-width: 120px;
    }
    .feature-section,
    .download-section {
      padding-block: 90px;
      padding-inline: 14px;
    }
    .section-heading {
      display: block;
    }
    .section-heading h2,
    .showcase h2,
    .download-heading h2,
    .final-cta h2 {
      font-size: clamp(2.6rem, 13vw, 4.2rem);
    }
    .section-heading > span {
      display: block;
      margin-top: 22px;
    }
    .feature-grid {
      display: block;
    }
    .feature-card {
      min-height: 390px;
      margin-bottom: 12px;
      padding: 22px;
    }
    .community-card {
      min-height: 520px;
    }
    .mini-community {
      grid-template-columns: 42px 105px 1fr;
      inset-inline: 16px;
    }
    .mini-chat {
      padding: 12px;
    }
    .showcase {
      min-height: auto;
      gap: 35px;
      padding: 90px 18px;
    }
    .showcase-images {
      min-height: 360px;
    }
    .image-main {
      width: 92%;
    }
    .image-secondary {
      width: 58%;
    }
    .platform-grid {
      display: block;
    }
    .platform-card {
      min-height: 340px;
      margin-bottom: 12px;
    }
    .final-cta {
      min-height: 560px;
    }
    .final-cta > div:not(.cta-orbit) {
      width: 100%;
      align-items: stretch;
      flex-direction: column;
    }
    .download-primary.compact {
      width: 100%;
    }
    footer {
      padding-inline: 20px;
    }
    .footer-links {
      margin-inline-start: 0;
    }
    .footer-bottom {
      gap: 12px;
      flex-direction: column;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .orb,
    .float-pill,
    .hero-kicker span,
    .ticker-track,
    .typing-bubble i,
    .bubble,
    .cta-mark,
    .cta-orbit,
    .hero-scroll span::after {
      animation: none !important;
    }
    .hero-visual,
    .app-window,
    .image-card {
      transform: none !important;
    }
    [data-reveal] {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
