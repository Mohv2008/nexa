# Dependency and license inventory

Exact JavaScript versions are in `package-lock.json`; Rust transitive versions are fixed by
`Cargo.lock` when the first native build runs. CI must commit that lock before release.

| Direct dependency                                   | Purpose                                    | License family                |
| --------------------------------------------------- | ------------------------------------------ | ----------------------------- |
| Svelte / SvelteKit / adapter-static                 | UI and static application build            | MIT                           |
| Vite / Vitest / Playwright                          | build and tests                            | MIT / Apache-2.0 (Playwright) |
| Hono                                                | small Worker router                        | MIT                           |
| Valibot                                             | runtime schemas                            | MIT                           |
| Wrangler / Workers types / Cloudflare Vitest plugin | Cloudflare development/runtime tests       | MIT / Apache-2.0 components   |
| Capacitor core, Android, app, push                  | Android WebView shell and FCM registration | MIT                           |
| Tauri JS/Rust crates and official plugins           | Windows WebView shell/updater/deep links   | Apache-2.0 OR MIT             |
| axe-core Playwright                                 | accessibility automation                   | MPL-2.0                       |
| Prettier / TypeScript / svelte-check                | developer tooling                          | MIT / Apache-2.0              |

Generated Android projects also depend on AndroidX (Apache-2.0), Gradle components (Apache-2.0),
JUnit (EPL-1.0), and Firebase Messaging under Google's SDK terms. This summary is not a substitute
for a release Software Bill of Materials. Generate one from the lockfiles, review notices, and run
OSV before distribution.

NEXA intentionally uses no UI kit, jQuery, Moment, ad/analytics SDK, or Electron runtime.
