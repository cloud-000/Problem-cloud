/**
 * Revision-scoped media caches.
 *
 * Problem images live in **CacheStorage**, keyed by package revision
 * (`offline-media-<packageRevision>`), not in IndexedDB. Two reasons, both from
 * `docs/offline.md` §4:
 *
 * - the service worker can answer a request for the *original* URL out of a
 *   cache, which is what makes an offline `<img src="https://cdn…">` resolve at
 *   all; nothing equivalent is possible from IndexedDB, and
 * - a failed refresh must leave the previous ready revision untouched. Because
 *   each revision owns its own cache, an aborted staging revision is deleted
 *   whole and the old one was never opened.
 *
 * Orphaned staging caches are collected at startup *after consulting
 * IndexedDB* — never on a timer and never by guessing from the name, because a
 * cache whose package is still staging looks exactly like an abandoned one.
 */

import { normalizeAssetUrl } from "./checksum";
import { resolveImageSrc } from "$lib/utils/math-parser";
import type { OfflineAssetV1 } from "./types";
import type { OfflineProblemV1 } from "./types";

export const MEDIA_CACHE_PREFIX = "offline-media-";

export function mediaCacheName(packageRevision: string): string {
    return `${MEDIA_CACHE_PREFIX}${packageRevision}`;
}

export function offlineMediaUrl(packageRevision: string, originalUrl: string): string {
    return `/_offline/media?revision=${encodeURIComponent(packageRevision)}&url=${encodeURIComponent(normalizeAssetUrl(originalUrl))}`;
}

/** Rewrite only URLs declared by this verified revision; unrelated prose is untouched. */
export function rewriteProblemMedia(
    problem: OfflineProblemV1,
    packageRevision: string,
    assets: OfflineAssetV1[],
): OfflineProblemV1 {
    const rewrite = (source: string | null): string | null => {
        if (source === null) return null;
        let next = source;
        for (const asset of assets) {
            next = next.split(asset.url).join(offlineMediaUrl(packageRevision, asset.url));
            const normalized = normalizeAssetUrl(asset.url);
            if (normalized !== asset.url) {
                next = next.split(normalized).join(offlineMediaUrl(packageRevision, normalized));
            }
        }
        // Markdown allows repo-relative authored targets. The renderer resolves
        // those to the CDN URL recorded in the asset manifest, so compare using
        // that same resolver and replace the target before the next parse.
        next = next.replace(
            /(!\[[^\]]*\]\(\s*)([^\s)]+)(\s*\))/g,
            (whole, before: string, target: string, after: string) => {
                const resolved = normalizeAssetUrl(resolveImageSrc(target));
                const asset = assets.find(
                    (candidate) => normalizeAssetUrl(candidate.url) === resolved,
                );
                return asset
                    ? `${before}${offlineMediaUrl(packageRevision, asset.url)}${after}`
                    : whole;
            },
        );
        return next;
    };
    return {
        ...problem,
        statement: rewrite(problem.statement),
        choices: problem.choices?.map((choice) => rewrite(choice) ?? "") ?? null,
        officialSolutions:
            problem.officialSolutions?.map((solution) => rewrite(solution) ?? "") ?? null,
    };
}

export type StageAssetsResult = {
    /** Assets fetched by this call (already-present ones are not refetched). */
    fetched: number;
    /** Bytes added, as reported by the responses that carried a length. */
    bytes: number;
};

export interface OfflineMediaStore {
    /** Fetch any not-yet-present asset into the revision's cache. */
    stage(
        packageRevision: string,
        assets: OfflineAssetV1[],
        checkoutId?: string,
    ): Promise<StageAssetsResult>;
    /** Which of `assets` are still absent — the package-ready precondition. */
    missing(packageRevision: string, assets: OfflineAssetV1[]): Promise<OfflineAssetV1[]>;
    /** Drop a revision's cache entirely (an aborted or superseded revision). */
    discard(packageRevision: string): Promise<void>;
    /** Delete every media cache whose revision is not in `keep`. */
    collectGarbage(keep: string[]): Promise<string[]>;
}

/** Raised when a required image cannot be downloaded; the package is not ready. */
export class OfflineAssetUnavailable extends Error {
    readonly url: string;

    constructor(url: string, detail: string) {
        super(`Could not download a required problem image (${url}): ${detail}`);
        this.name = "OfflineAssetUnavailable";
        this.url = url;
    }
}

export function cacheStorageAvailable(): boolean {
    return typeof caches !== "undefined";
}

/**
 * Fetch an image directly when CORS permits it, then fall back to the
 * authenticated same-origin checkout asset endpoint. The endpoint independently
 * proves that the key and URL occur in this user's issued package, so callers
 * cannot turn it into an arbitrary URL proxy.
 */
export async function fetchRequiredAsset(
    asset: OfflineAssetV1,
    checkoutId: string | undefined,
    fetcher: typeof fetch = fetch,
): Promise<Response> {
    const url = normalizeAssetUrl(asset.url);
    let directDetail = "direct request failed";
    try {
        const direct = await fetcher(url, { mode: "cors", credentials: "omit" });
        if (direct.ok) return direct;
        directDetail = `direct request returned HTTP ${direct.status}`;
    } catch (error) {
        directDetail = String(error);
    }

    if (!checkoutId) throw new OfflineAssetUnavailable(url, directDetail);
    let proxied: Response;
    try {
        proxied = await fetcher(
            `/api/offline/packages/${encodeURIComponent(checkoutId)}/assets/${encodeURIComponent(asset.key)}`,
            { credentials: "same-origin" },
        );
    } catch (error) {
        throw new OfflineAssetUnavailable(
            url,
            `${directDetail}; server fallback failed: ${String(error)}`,
        );
    }
    if (!proxied.ok) {
        throw new OfflineAssetUnavailable(
            url,
            `${directDetail}; server fallback returned HTTP ${proxied.status}`,
        );
    }
    return proxied;
}

export function createCacheStorageMediaStore(): OfflineMediaStore {
    return {
        async stage(packageRevision, assets, checkoutId) {
            const cache = await caches.open(mediaCacheName(packageRevision));
            let fetched = 0;
            let bytes = 0;
            for (const asset of assets) {
                const url = normalizeAssetUrl(asset.url);
                if (await cache.match(url)) continue;
                // Never use `no-cors`: an opaque response hides both 404s and
                // byte length. The same-origin fallback remains fully readable.
                const response = await fetchRequiredAsset(asset, checkoutId);
                const body = await response.clone().arrayBuffer();
                await cache.put(url, response);
                fetched += 1;
                bytes += body.byteLength;
            }
            return { fetched, bytes };
        },

        async missing(packageRevision, assets) {
            if (!(await caches.has(mediaCacheName(packageRevision)))) return [...assets];
            const cache = await caches.open(mediaCacheName(packageRevision));
            const absent: OfflineAssetV1[] = [];
            for (const asset of assets) {
                if (!(await cache.match(normalizeAssetUrl(asset.url)))) absent.push(asset);
            }
            return absent;
        },

        async discard(packageRevision) {
            await caches.delete(mediaCacheName(packageRevision));
        },

        async collectGarbage(keep) {
            const kept = new Set(keep.map(mediaCacheName));
            const removed: string[] = [];
            for (const name of await caches.keys()) {
                if (!name.startsWith(MEDIA_CACHE_PREFIX) || kept.has(name)) continue;
                await caches.delete(name);
                removed.push(name);
            }
            return removed;
        },
    };
}

/**
 * An in-process media store. Used in tests and wherever CacheStorage is absent;
 * it records what *would* have been staged so the installer's ready-check is
 * still exercised end to end.
 */
export function createMemoryMediaStore(
    fetchAsset: (url: string) => Promise<number> = async () => 0,
): OfflineMediaStore & { caches: Map<string, Map<string, number>> } {
    const stores = new Map<string, Map<string, number>>();

    function open(revision: string) {
        let cache = stores.get(mediaCacheName(revision));
        if (!cache) {
            cache = new Map();
            stores.set(mediaCacheName(revision), cache);
        }
        return cache;
    }

    return {
        caches: stores,
        async stage(packageRevision, assets) {
            const cache = open(packageRevision);
            let fetched = 0;
            let bytes = 0;
            for (const asset of assets) {
                const url = normalizeAssetUrl(asset.url);
                if (cache.has(url)) continue;
                const size = await fetchAsset(url);
                cache.set(url, size);
                fetched += 1;
                bytes += size;
            }
            return { fetched, bytes };
        },
        async missing(packageRevision, assets) {
            const cache = stores.get(mediaCacheName(packageRevision));
            return assets.filter((asset) => !cache?.has(normalizeAssetUrl(asset.url)));
        },
        async discard(packageRevision) {
            stores.delete(mediaCacheName(packageRevision));
        },
        async collectGarbage(keep) {
            const kept = new Set(keep.map(mediaCacheName));
            const removed: string[] = [];
            for (const name of [...stores.keys()]) {
                if (kept.has(name)) continue;
                stores.delete(name);
                removed.push(name);
            }
            return removed;
        },
    };
}
