import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const configuredApi = process.env.PUBLIC_API_URL ?? 'http://localhost:8787/v1';
type CspHost = `${string}://${string}.${string}` | `${string}://localhost:${number}`;
const apiOrigin = new URL(configuredApi).origin as CspHost;
const websocketOrigin = apiOrigin.replace(/^http/u, 'ws') as CspHost;

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ fallback: '200.html', precompress: true, strict: true }),
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          'base-uri': ['self'],
          'object-src': ['none'],
          'frame-ancestors': ['none'],
          'img-src': ['self', 'data:', 'blob:', apiOrigin],
          'media-src': ['self', 'blob:', apiOrigin],
          'connect-src': ['self', apiOrigin, websocketOrigin],
          'style-src': ['self', 'unsafe-inline'],
        },
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  build: {
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
  },
});
