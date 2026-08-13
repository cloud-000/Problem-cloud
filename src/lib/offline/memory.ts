/**
 * An in-process {@link OfflineStorage} with real transaction semantics.
 *
 * This exists so the repository's atomicity claims are testable. "If any step
 * fails, none becomes visible" (`docs/offline-contracts.md` §5) is the whole
 * point of `recordSubmission` and of staged installation, and a fake that
 * applies writes as they arrive would pass every test while the guarantee was
 * broken. So: writes land in a per-transaction overlay and are published only
 * when `body` resolves; a throw discards them.
 *
 * It is also what makes the repository usable during SSR and in a browser that
 * has no IndexedDB at all — there it holds nothing durable, which is honest,
 * because nothing durable is available.
 */

import {
    compareKeys,
    keyFor,
    type OfflineStorage,
    type OfflineTx,
    type QueryOptions,
    type StoreKey,
} from "./storage";
import { OFFLINE_STORES, type StoreSchema } from "./schema";

function encode(key: StoreKey): string {
    return JSON.stringify(key);
}

type Table = Map<string, { key: StoreKey; value: unknown }>;

class MemoryTx implements OfflineTx {
    /** Pending writes, keyed store → encoded key → value (or a delete tombstone). */
    readonly #writes = new Map<string, Map<string, { key: StoreKey; value: unknown } | null>>();

    constructor(
        private readonly tables: Map<string, Table>,
        private readonly schemas: Map<string, StoreSchema>,
        private readonly readonlyMode: boolean,
    ) {}

    #schema(store: string): StoreSchema {
        const schema = this.schemas.get(store);
        if (!schema) throw new Error(`Unknown offline store "${store}"`);
        return schema;
    }

    #pending(store: string) {
        let map = this.#writes.get(store);
        if (!map) {
            map = new Map();
            this.#writes.set(store, map);
        }
        return map;
    }

    /** The store's effective contents: committed rows with this tx's writes on top. */
    #rows(store: string): { key: StoreKey; value: unknown }[] {
        const committed = this.tables.get(store) ?? new Map();
        const pending = this.#writes.get(store);
        const merged = new Map(committed);
        if (pending) {
            for (const [encoded, entry] of pending) {
                if (entry === null) merged.delete(encoded);
                else merged.set(encoded, entry);
            }
        }
        return [...merged.values()].sort((a, b) => compareKeys(a.key, b.key));
    }

    #matching(store: string, options?: QueryOptions) {
        const rows = this.#rows(store);
        if (!options?.index) {
            if (!options?.only) return rows;
            const wanted = encode(options.only);
            return rows.filter((row) => encode(row.key) === wanted);
        }
        const schema = this.#schema(store);
        const index = schema.indexes.find((i) => i.name === options.index);
        if (!index) {
            throw new Error(`Unknown index "${options.index}" on "${store}"`);
        }
        const wanted = options.only ? encode(options.only) : null;
        return rows
            .map((row) => ({ row, indexKey: keyFor(row.value, index.keyPath) }))
            // A record missing any index component is absent from the index,
            // exactly as IndexedDB would leave it out.
            .filter((entry) => entry.indexKey !== null)
            .filter((entry) => wanted === null || encode(entry.indexKey!) === wanted)
            .sort((a, b) => compareKeys(a.indexKey!, b.indexKey!))
            .map((entry) => entry.row);
    }

    #assertWritable() {
        if (this.readonlyMode) {
            throw new Error("write attempted in a readonly offline transaction");
        }
    }

    async get<T>(store: string, key: StoreKey): Promise<T | undefined> {
        const encoded = encode(key);
        const pending = this.#writes.get(store)?.get(encoded);
        if (pending !== undefined) return (pending?.value as T) ?? undefined;
        return this.tables.get(store)?.get(encoded)?.value as T | undefined;
    }

    async getAll<T>(store: string, options?: QueryOptions): Promise<T[]> {
        return this.#matching(store, options).map((row) => row.value as T);
    }

    async put(store: string, value: unknown): Promise<void> {
        this.#assertWritable();
        const key = keyFor(value, this.#schema(store).keyPath);
        if (!key) {
            throw new Error(`Record is missing its key path for store "${store}"`);
        }
        this.#pending(store).set(encode(key), { key, value: structuredClone(value) });
    }

    async delete(store: string, key: StoreKey): Promise<void> {
        this.#assertWritable();
        this.#schema(store);
        this.#pending(store).set(encode(key), null);
    }

    async deleteAll(store: string, options?: QueryOptions): Promise<number> {
        this.#assertWritable();
        const schema = this.#schema(store);
        const rows = this.#matching(store, options);
        for (const row of rows) {
            const key = keyFor(row.value, schema.keyPath);
            if (key) this.#pending(store).set(encode(key), null);
        }
        return rows.length;
    }

    async count(store: string, options?: QueryOptions): Promise<number> {
        return this.#matching(store, options).length;
    }

    /** Publish this transaction's writes. Called only on a clean `body`. */
    commit(): void {
        for (const [store, pending] of this.#writes) {
            let table = this.tables.get(store);
            if (!table) {
                table = new Map();
                this.tables.set(store, table);
            }
            for (const [encoded, entry] of pending) {
                if (entry === null) table.delete(encoded);
                else table.set(encoded, entry);
            }
        }
    }
}

export type MemoryStorage = OfflineStorage & {
    /** Test/debug view of a store's contents, in primary-key order. */
    dump<T>(store: string): T[];
};

export function createMemoryStorage(): MemoryStorage {
    const tables = new Map<string, Map<string, { key: StoreKey; value: unknown }>>();
    const schemas = new Map(OFFLINE_STORES.map((store) => [store.name, store]));
    // One promise chain serializes transactions, so two concurrent writers see
    // each other's committed state rather than interleaving into one overlay.
    let queue: Promise<unknown> = Promise.resolve();
    let closed = false;

    return {
        async transaction(stores, mode, body) {
            if (closed) throw new Error("offline storage is closed");
            for (const store of stores) {
                if (!schemas.has(store)) {
                    throw new Error(`Unknown offline store "${store}"`);
                }
            }
            const run = queue.then(async () => {
                const tx = new MemoryTx(tables, schemas, mode === "readonly");
                const result = await body(tx);
                tx.commit();
                return result;
            });
            // Keep the chain alive past a rejection so one failed transaction
            // does not poison every later one.
            queue = run.catch(() => undefined);
            return run as Promise<never>;
        },
        close() {
            closed = true;
        },
        dump<T>(store: string): T[] {
            const table = tables.get(store);
            if (!table) return [];
            return [...table.values()]
                .sort((a, b) => compareKeys(a.key, b.key))
                .map((row) => row.value as T);
        },
    };
}
