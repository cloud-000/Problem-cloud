/**
 * Playwright plumbing every measurement shares: a context that is always a true
 * cold load, a settle, session bootstrap, and the sidebar locator.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { BASE_URL, credentials } from "./config";
import { PERF_INIT } from "./probes";

export async function newContext(browser: Browser, storageState?: object): Promise<BrowserContext> {
    const context = await browser.newContext({
        storageState: storageState as never,
        // True cold load: never let a service worker answer a navigation.
        serviceWorkers: "block",
        viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(PERF_INIT);
    return context;
}

/** Wait for the app to look quiet, without failing if it never fully idles. */
export async function settle(page: Page, ms = 1200) {
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(ms);
}

/**
 * Scope nav clicks to the sidebar. The same route can appear twice in the DOM
 * (expanded item + collapsed rail), and bare getByRole is strict-mode fatal.
 */
export const sidebarLink = (page: Page, name: string) =>
    page.locator('[data-slot="sidebar-root"]').getByRole("link", { name });

/** Log in once and hand the storage state to every later context. */
export async function login(browser: Browser): Promise<object> {
    const { email, password } = credentials();
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "domcontentloaded" });
    // Target by form name, not label: the password field's <label> also wraps
    // the "Show password" toggle, so getByLabel resolves to two elements.
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    // authGuard bounces authenticated users off /auth/login, so the URL leaving
    // it is the signal that the cookie landed.
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 15000 });
    await page.getByRole("link", { name: "Library" }).waitFor({ timeout: 15000 });
    const state = await context.storageState();
    await context.close();
    return state as object;
}
