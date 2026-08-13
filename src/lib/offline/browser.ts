/**
 * The browser's one offline repository.
 *
 * Opening the database is deliberately lazy and memoized: `/offline` is
 * prerendered and hydrates with no server data at all, so nothing may touch
 * IndexedDB at module scope, and two surfaces asking for the repository must
 * get the same connection rather than two upgrade attempts racing each other.
 *
 * Missing IndexedDB, CacheStorage, or service-worker support is reported as an
 * explicit unsupported/storage-unavailable state — before any checkout is
 * created, never as a crash halfway through a download.
 */

import { browser } from "$app/environment";
import { createIdbStorage, indexedDBAvailable, openOfflineDatabase } from "./idb";
import { cacheStorageAvailable, createCacheStorageMediaStore } from "./media";
import { OfflineRepository } from "./repository";
import { OfflineStorageUnavailable } from "./storage";

export type OfflineSupport = {
    indexedDB: boolean;
    cacheStorage: boolean;
    serviceWorker: boolean;
};

export function offlineSupport(): OfflineSupport {
    return {
        indexedDB: indexedDBAvailable(),
        cacheStorage: cacheStorageAvailable(),
        serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    };
}

/** True when this browser can hold a package at all. */
export function offlineSupported(support = offlineSupport()): boolean {
    return support.indexedDB && support.cacheStorage;
}

let pending: Promise<OfflineRepository> | null = null;

export function offlineRepository(): Promise<OfflineRepository> {
    if (!pending) {
        pending = (async () => {
            if (!browser) {
                throw new OfflineStorageUnavailable(
                    "unsupported",
                    "The offline repository is only available in the browser",
                );
            }
            const support = offlineSupport();
            if (!support.indexedDB) {
                throw new OfflineStorageUnavailable(
                    "unsupported",
                    "This browser has no IndexedDB, so downloads cannot be stored",
                );
            }
            const db = await openOfflineDatabase();
            return new OfflineRepository({
                storage: createIdbStorage(db),
                // Without CacheStorage a package can never be made ready, but
                // the repository still opens so pending work stays readable.
                media: support.cacheStorage
                    ? createCacheStorageMediaStore()
                    : undefined,
            });
        })();
        // A failed open must not be memoized as a permanent failure: another
        // tab holding the old version is a state the user can fix and retry.
        pending.catch(() => {
            pending = null;
        });
    }
    return pending;
}

/** Drop the memoized connection (account switch, tests). */
export function resetOfflineRepository(): void {
    pending = null;
}
