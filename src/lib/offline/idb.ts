/**
 * The real, versioned IndexedDB backend.
 *
 * Two rules from `docs/offline-contracts.md` §3 shape everything here:
 *
 * 1. **Schema upgrades are additive and transactional.** `upgradeSchema` creates
 *    stores and indexes that a given version introduced and never drops one, so
 *    an old package can be marked `incompatible` and re-downloaded while the
 *    outbox beside it is preserved and parsed.
 * 2. **Application startup never responds to a migration error by deleting the
 *    database.** A failed open surfaces as {@link OfflineStorageUnavailable};
 *    the caller degrades to "storage unavailable", it does not reach for
 *    `deleteDatabase`. What is in there is unsynced user work.
 */

import {
    OfflineQuotaExceeded,
    OfflineStorageUnavailable,
    type OfflineStorage,
    type OfflineTx,
    type QueryOptions,
    type StoreKey,
} from "./storage";
import {
    OFFLINE_DB_NAME,
    OFFLINE_SCHEMA_VERSION,
    OFFLINE_STORES,
    type StoreSchema,
} from "./schema";

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
}

/** Create anything `from` → `to` introduced, without touching what exists. */
export function upgradeSchema(
    db: IDBDatabase,
    transaction: IDBTransaction,
    from: number,
    to: number,
    stores: StoreSchema[] = OFFLINE_STORES,
): void {
    for (const schema of stores) {
        if (schema.since > to) continue;
        const store = db.objectStoreNames.contains(schema.name)
            ? transaction.objectStore(schema.name)
            : db.createObjectStore(schema.name, { keyPath: schema.keyPath });
        for (const index of schema.indexes) {
            if (store.indexNames.contains(index.name)) continue;
            store.createIndex(index.name, index.keyPath, {
                unique: index.unique ?? false,
            });
        }
    }
    // `from` is unused today because v1 is the first schema; it is threaded
    // through so a future migration can branch on where it started rather than
    // re-deriving it, which is how additive upgrades stay reviewable.
    void from;
}

export function indexedDBAvailable(): boolean {
    return typeof indexedDB !== "undefined";
}

function isQuotaError(error: unknown): boolean {
    return (
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" ||
            // Firefox's legacy spelling.
            error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
}

class IdbTx implements OfflineTx {
    constructor(
        private readonly tx: IDBTransaction,
        private readonly schemas: Map<string, StoreSchema>,
    ) {}

    #source(store: string, options?: QueryOptions): IDBObjectStore | IDBIndex {
        if (!this.schemas.has(store)) {
            throw new Error(`Unknown offline store "${store}"`);
        }
        const objectStore = this.tx.objectStore(store);
        return options?.index ? objectStore.index(options.index) : objectStore;
    }

    async get<T>(store: string, key: StoreKey): Promise<T | undefined> {
        return request(this.tx.objectStore(store).get(key as IDBValidKey));
    }

    async getAll<T>(store: string, options?: QueryOptions): Promise<T[]> {
        const source = this.#source(store, options);
        const range = options?.only
            ? IDBKeyRange.only(options.only as IDBValidKey)
            : undefined;
        return request(source.getAll(range)) as Promise<T[]>;
    }

    async put(store: string, value: unknown): Promise<void> {
        try {
            await request(this.tx.objectStore(store).put(value as never));
        } catch (error) {
            if (isQuotaError(error)) throw new OfflineQuotaExceeded();
            throw error;
        }
    }

    async delete(store: string, key: StoreKey): Promise<void> {
        await request(this.tx.objectStore(store).delete(key as IDBValidKey));
    }

    async deleteAll(store: string, options?: QueryOptions): Promise<number> {
        const source = this.#source(store, options);
        const range = options?.only
            ? IDBKeyRange.only(options.only as IDBValidKey)
            : undefined;
        const keys = (await request(
            source instanceof IDBIndex
                ? source.getAllKeys(range)
                : source.getAllKeys(range),
        )) as IDBValidKey[];
        const objectStore = this.tx.objectStore(store);
        for (const key of keys) await request(objectStore.delete(key));
        return keys.length;
    }

    async count(store: string, options?: QueryOptions): Promise<number> {
        const source = this.#source(store, options);
        const range = options?.only
            ? IDBKeyRange.only(options.only as IDBValidKey)
            : undefined;
        return request(source.count(range));
    }
}

/**
 * Open (and if necessary migrate) the offline database.
 *
 * `blocked` is surfaced rather than waited out: another tab holding the old
 * version open is a state the user can fix, and silently hanging on it looks
 * exactly like a broken app.
 */
export async function openOfflineDatabase(
    name = OFFLINE_DB_NAME,
    version = OFFLINE_SCHEMA_VERSION,
): Promise<IDBDatabase> {
    if (!indexedDBAvailable()) {
        throw new OfflineStorageUnavailable(
            "unsupported",
            "This browser has no IndexedDB, so offline data cannot be stored",
        );
    }
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(name, version);
        open.onupgradeneeded = (event) => {
            const db = open.result;
            const tx = open.transaction;
            if (!tx) {
                reject(
                    new OfflineStorageUnavailable(
                        "migration-failed",
                        "The upgrade transaction was missing",
                    ),
                );
                return;
            }
            try {
                upgradeSchema(db, tx, event.oldVersion, event.newVersion ?? version);
            } catch (error) {
                reject(
                    new OfflineStorageUnavailable(
                        "migration-failed",
                        `Offline schema upgrade failed: ${String(error)}`,
                    ),
                );
            }
        };
        open.onblocked = () =>
            reject(
                new OfflineStorageUnavailable(
                    "blocked",
                    "Another tab is holding an older version of the offline database open",
                ),
            );
        open.onsuccess = () => resolve(open.result);
        open.onerror = () =>
            reject(
                new OfflineStorageUnavailable(
                    "migration-failed",
                    `Could not open the offline database: ${String(open.error)}`,
                ),
            );
    });
}

export function createIdbStorage(db: IDBDatabase): OfflineStorage {
    const schemas = new Map(OFFLINE_STORES.map((store) => [store.name, store]));

    return {
        transaction(stores, mode, body) {
            return new Promise((resolve, reject) => {
                let tx: IDBTransaction;
                try {
                    tx = db.transaction(stores, mode);
                } catch (error) {
                    reject(error);
                    return;
                }
                let result: unknown;
                let settled = false;

                tx.oncomplete = () => {
                    if (!settled) resolve(result as never);
                };
                tx.onabort = () => {
                    settled = true;
                    const error = tx.error;
                    reject(
                        isQuotaError(error)
                            ? new OfflineQuotaExceeded()
                            : (error ?? new Error("offline transaction aborted")),
                    );
                };

                body(new IdbTx(tx, schemas)).then(
                    (value) => {
                        result = value;
                    },
                    (error) => {
                        settled = true;
                        // Roll the whole transaction back: a partially applied
                        // local write is exactly what these guarantees exclude.
                        try {
                            tx.abort();
                        } catch {
                            // Already finished; the rejection below still stands.
                        }
                        reject(isQuotaError(error) ? new OfflineQuotaExceeded() : error);
                    },
                );
            });
        },
        close() {
            db.close();
        },
    };
}

/** Open the database and wrap it as storage. */
export async function createOfflineStorage(): Promise<OfflineStorage> {
    return createIdbStorage(await openOfflineDatabase());
}
