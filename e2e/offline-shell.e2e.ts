import { expect, test, type Page } from "@playwright/test";

/**
 * The credential-free shell.
 *
 * The assertion that matters most here is a negative one: **no token-bearing
 * response may enter CacheStorage.** The root layout's payload used to carry
 * access and refresh tokens, and caching it would persist credentials on disk
 * and could resurrect the wrong account after a logout or an account switch.
 * That is why the authenticated load moved under `(app)` and why the service
 * worker refuses to store `__data.json`, `/api/*`, and Supabase responses.
 */

async function cacheContents(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        if (!("caches" in window)) return [];
        const urls: string[] = [];
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) urls.push(request.url);
        }
        return urls;
    });
}

async function serviceWorkerReady(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return false;
        const ready = navigator.serviceWorker.ready.then(() => true);
        const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000));
        return Promise.race([ready, timeout]);
    });
}

test.describe("the offline entry document", () => {
    test("renders without any server data", async ({ page }) => {
        const response = await page.goto("/offline");
        expect(response?.ok()).toBe(true);
        await expect(page.getByText("Offline", { exact: true })).toBeVisible();

        const html = await page.content();
        // A prerendered, ssr:false document has no `__data` payload to leak.
        expect(html).not.toContain("access_token");
        expect(html).not.toContain("refresh_token");
    });

    test("says what it knows rather than imitating the signed-in app", async ({ page }) => {
        await page.goto("/offline");
        // With no local account marker there is nothing to open, and a cached
        // response is never used to decide otherwise.
        await expect(
            page.getByRole("heading", { name: /No account is open|Nothing is downloaded/ }),
        ).toBeVisible();
    });

    test("caches no personalized or credentialed response", async ({ page }) => {
        await page.goto("/");
        await page.goto("/offline");
        await page.waitForTimeout(500);

        for (const url of await cacheContents(page)) {
            expect(url, `${url} must not be cached`).not.toContain("__data.json");
            expect(url, `${url} must not be cached`).not.toContain("/api/");
            expect(url, `${url} must not be cached`).not.toContain("supabase.co");
            expect(url, `${url} must not be cached`).not.toContain("/auth/");
        }
    });
});

test.describe("the service worker", () => {
    test("precaches the offline document and the vendored render assets", async ({
        page,
    }) => {
        await page.goto("/offline");
        // The worker is only registered in a production build; skip rather than
        // pretend when running against the dev server.
        test.skip(!(await serviceWorkerReady(page)), "no service worker (dev server)");

        const urls = await cacheContents(page);
        expect(urls.some((url) => url.endsWith("/offline"))).toBe(true);
        expect(urls.some((url) => url.endsWith("/offline-practice-shell"))).toBe(true);
        expect(urls.some((url) => url.includes("/vendor/katex/katex.min.css"))).toBe(true);
        expect(urls.some((url) => url.includes("/fonts/"))).toBe(true);
    });

    test("uses the Practice shell only for an explicit package selector", async ({
        page,
        context,
    }) => {
        await page.goto("/offline");
        test.skip(!(await serviceWorkerReady(page)), "no service worker (dev server)");

        await context.setOffline(true);
        try {
            await page.goto("/practice?offlinePackage=missing-package");
            await expect(page).toHaveURL(/\/practice\?offlinePackage=missing-package/);
            await expect(
                page.getByRole("heading", { name: "Could not open this download" }),
            ).toBeVisible();

            await page.goto("/practice");
            await expect(page.getByText("Offline", { exact: true })).toBeVisible();
        } finally {
            await context.setOffline(false);
        }
    });

    test("serves the offline document when a navigation cannot reach the server", async ({
        page,
        context,
    }) => {
        await page.goto("/offline");
        test.skip(!(await serviceWorkerReady(page)), "no service worker (dev server)");

        await context.setOffline(true);
        try {
            await page.goto("/library");
            await expect(
                page.getByText("Offline", { exact: true }),
            ).toBeVisible();

            // And a reload while still offline stays on that document.
            await page.reload();
            await expect(page.getByText("Offline", { exact: true })).toBeVisible();
        } finally {
            await context.setOffline(false);
        }
    });
});
