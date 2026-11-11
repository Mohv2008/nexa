import { describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config';

describe('public environment configuration', () => {
  it('exposes PUBLIC_ variables to the client bundle', () => {
    // SvelteKit 3 does not set a Vite env prefix. Without one, every
    // `import.meta.env.PUBLIC_*` lookup resolves to undefined and the app
    // silently falls back to http://localhost:8787/v1 in production, which
    // surfaces only as "Unable to reach NEXA" in the browser.
    expect(viteConfig.envPrefix).toBe('PUBLIC_');
  });

  it('uses the configured API origin instead of the local fallback', async () => {
    vi.stubEnv('PUBLIC_API_URL', 'https://api.example.test/v1');
    vi.stubEnv('PUBLIC_WEB_URL', 'https://web.example.test');
    vi.resetModules();
    const { config } = await import('./config');
    expect(config.apiUrl).toBe('https://api.example.test/v1');
    expect(config.webUrl).toBe('https://web.example.test');
  });

  it('falls back to local endpoints when nothing is configured', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const { config } = await import('./config');
    expect(config.apiUrl).toBe('http://localhost:8787/v1');
    expect(config.webUrl).toBe('http://localhost:5173');
  });
});
