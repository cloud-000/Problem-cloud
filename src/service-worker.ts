/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * The minimal offline service worker (`docs/offline.md` §3b).
 *
 * Its job is small and its restraint is the point:
 *
 * - **cache-first** for versioned build output and the deliberately selected
 *   static assets, which is safe because the cache name carries the build
 *   version and a new deployment simply builds a new cache;
 * - **network-first** for navigations, falling back to the neutral `/offline`
 *   document when the network cannot be reached;
 * - **cache-only** for problem media, served out of the active package
 *   revision's cache under the image's original URL — the reason those live in
 *   CacheStorage at all;
 * - and **nothing else**.
 *
 * It must never opportunistically cache successful GETs. The app has
 * personalized reads, answer-bearing payloads, and API responses whose
 * staleness rules differ, and the IndexedDB repository owns the data cache
 * explicitly. In particular `__data.json`, `/api/*`, and any Supabase response
 * are never stored: the root layout's payload used to contain access and
 * refresh tokens, and caching that would persist credentials in CacheStorage
 * and could resurrect the wrong account after a logout or an account switch.
 * The authenticated load now lives under `(app)`, and this worker is the second
 * lock on the same door.
 */

import { build, files, prerendered, version } from "$service-worker";

declare const self: ServiceWorkerGlobalScope;

const CACHE = `pc-assets-${version}`;
/** Media caches are owned by the repository; this worker only reads them. */
const MEDIA_CACHE_PREFIX = "offline-media-";

/** The credential-free document a failed navigation falls back to. */
const OFFLINE_DOCUMENT = "/offline";

/**
 * Static files worth precaching. `static/` also holds things a cold offline
 * start does not need (robots.txt), so this is an allowlist rather than
 * `files` wholesale — the fonts and KaTeX are exactly what an offline problem
 * cannot render without.
 */
function shouldPrecache(path: string): boolean {
    return path.startsWith("/fonts/") || path.startsWith("/vendor/");
}

const PRECACHE = [
    ...build,
    ...files.filter(shouldPrecache),
    ...prerendered.filter((path) => path === OFFLINE_DOCUMENT),
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await cache.addAll(PRECACHE);
            // A new build's assets are ready the moment they are cached; there
            // is no half-updated state to protect, because the cache is
            // versioned and the old one is still serving until activate.
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys()) {
                // Media caches belong to package revisions, not to builds. A
                // deployment must not delete a downloaded package's images.
                if (key.startsWith(MEDIA_CACHE_PREFIX)) continue;
                if (key !== CACHE) await caches.delete(key);
            }
            await self.clients.claim();
        })(),
    );
});

/** Anything personalized, credentialed, or API-shaped. Never cached. */
function isPrivate(url: URL): boolean {
    return (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/auth/") ||
        url.pathname.endsWith("/__data.json") ||
        url.pathname.endsWith("_data.json") ||
        url.hostname.endsWith(".supabase.co")
    );
}

/** Find a problem image in whichever package revision downloaded it. */
async function matchMedia(request: Request): Promise<Response | undefined> {
    for (const key of await caches.keys()) {
        if (!key.startsWith(MEDIA_CACHE_PREFIX)) continue;
        const cache = await caches.open(key);
        const hit = await cache.match(request.url);
        if (hit) return hit;
    }
    return undefined;
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (isPrivate(url)) return; // straight to the network, never stored

    const isSameOrigin = url.origin === self.location.origin;
    const isPrecached =
        isSameOrigin && PRECACHE.includes(url.pathname);

    if (isPrecached) {
        // Versioned build output: the cached copy is definitionally the right
        // one for this deployment.
        event.respondWith(
            (async () => {
                const cached = await caches.match(url.pathname);
                return cached ?? fetch(request);
            })(),
        );
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    return await fetch(request);
                } catch {
                    const offline = await caches.match(OFFLINE_DOCUMENT);
                    return (
                        offline ??
                        new Response("Offline", {
                            status: 503,
                            headers: { "content-type": "text/plain" },
                        })
                    );
                }
            })(),
        );
        return;
    }

    if (request.destination === "image" && !isSameOrigin) {
        event.respondWith(
            (async () => {
                try {
                    return await fetch(request);
                } catch (error) {
                    const cached = await matchMedia(request);
                    if (cached) return cached;
                    throw error;
                }
            })(),
        );
    }
});

export {};
