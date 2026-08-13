import { defineConfig, devices } from "@playwright/test";

/**
 * The production-browser harness (`docs/offline-contracts.md` §9).
 *
 * Offline behavior is the one part of this app that unit tests structurally
 * cannot reach: a service worker, a real IndexedDB upgrade, a browser restart,
 * and what does *not* end up in CacheStorage are all properties of a browser,
 * not of a module. `bun test` covers parsers, checksums, predicates, overlays
 * and acknowledgement; this covers the rest.
 *
 * **Release gate: Chromium 111+ and Safari/iOS 16.4+.** Firefox 114+ is
 * supported best-effort and is not a gate; embedded Kindle/E-Ink browsers are
 * explicitly unsupported for offline v1.
 *
 * The service worker only exists in a production build, so the SW and
 * offline-navigation specs run against `build && preview`. Because this
 * repository requires explicit authorization before running a build, the server
 * command is *not* started implicitly: set `PC_E2E_BASE_URL` to a server you
 * already have running, or `PC_E2E_START=1` to let Playwright build and preview
 * one itself.
 *
 * Browsers are not vendored. Install them once with:
 *
 *     bunx playwright install chromium webkit
 */

const PORT = Number(process.env.PC_E2E_PORT ?? 4173);
const baseURL = process.env.PC_E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: "e2e",
    // `.e2e.ts`, not `.spec.ts`: `bun test` collects `*.spec.*` and would try to
    // run these specs itself, where there is no browser.
    testMatch: /.*\.e2e\.ts$/,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL,
        trace: "on-first-retry",
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ],
    webServer: process.env.PC_E2E_START
        ? {
              command: "bun run build && bun run preview --port " + PORT,
              url: baseURL,
              reuseExistingServer: !process.env.CI,
              timeout: 180_000,
          }
        : undefined,
});
