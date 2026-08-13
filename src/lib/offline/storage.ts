/**
 * The storage seam the offline repository writes through.
 *
 * Two implementations exist: `idb.ts` (the real, versioned IndexedDB database)
 * and `memory.ts` (an in-process backend with the same transaction semantics).
 * The seam is not indirection for its own sake — the repository's hard
 * guarantees are *transactional* ("if any step fails, none becomes visible",
 * `docs/offline-contracts.md` §5), and those have to be provable in `bun test`,
 * which has no IndexedDB. The memory backend therefore implements rollback for
 * real rather than pretending, and Playwright exercises the IndexedDB one.
 *
 * Keys are always arrays, even single-component ones, so a compound key and a
 * simple key are the same shape everywhere and no call site has to remember
 * which store is which.
 */

/** A key component. IndexedDB cannot key on `null`/`undefined`. */
export type KeyPart = string | number;
export type StoreKey = KeyPart[];

export type QueryOptions = {
    /** Index to read through; omit to read through the primary key. */
    index?: string;
    /** Exact index/primary key to match. */
    only?: StoreKey;
};

export interface OfflineTx {
    get<T>(store: string, key: StoreKey): Promise<T | undefined>;
    getAll<T>(store: string, options?: QueryOptions): Promise<T[]>;
    put(store: string, value: unknown): Promise<void>;
    delete(store: string, key: StoreKey): Promise<void>;
    /** Delete every record matching `options`; returns how many went. */
    deleteAll(store: string, options?: QueryOptions): Promise<number>;
    count(store: string, options?: QueryOptions): Promise<number>;
}

export interface OfflineStorage {
    /**
     * Run `body` in one transaction over `stores`.
     *
     * **Never await anything but this transaction's own operations inside
     * `body`.** IndexedDB commits a transaction as soon as its request queue
     * drains, so awaiting a fetch or a timer inside one silently ends it and the
     * writes that follow throw. Asset downloads happen before the transaction
     * opens, which is why the contract sequences them that way.
     */
    transaction<T>(
        stores: string[],
        mode: "readonly" | "readwrite",
        body: (tx: OfflineTx) => Promise<T>,
    ): Promise<T>;
    close(): void;
}

/** Raised when the browser refuses a write for lack of space. */
export class OfflineQuotaExceeded extends Error {
    constructor(message = "The browser is out of storage for offline data") {
        super(message);
        this.name = "OfflineQuotaExceeded";
    }
}

/** Raised when the durable schema cannot be opened or migrated. */
export class OfflineStorageUnavailable extends Error {
    readonly reason: "unsupported" | "blocked" | "migration-failed";

    constructor(reason: OfflineStorageUnavailable["reason"], message: string) {
        super(message);
        this.name = "OfflineStorageUnavailable";
        this.reason = reason;
    }
}

/** IndexedDB's key ordering, for backends that have to sort by hand. */
export function compareKeys(a: StoreKey, b: StoreKey): number {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
        const left = a[i];
        const right = b[i];
        if (left === right) continue;
        // Numbers sort before strings, matching IndexedDB's type precedence.
        const leftIsNumber = typeof left === "number";
        const rightIsNumber = typeof right === "number";
        if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
        return left < right ? -1 : 1;
    }
    return a.length - b.length;
}

/** Read a possibly dotted key path (`series.id`) out of a record. */
export function readPath(value: unknown, path: string): unknown {
    let current: unknown = value;
    for (const segment of path.split(".")) {
        if (current === null || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

/**
 * The key a record produces for a key path, or `null` when any component is
 * absent — IndexedDB leaves such a record out of the index entirely, and the
 * memory backend has to agree or the two disagree about what a query returns.
 */
export function keyFor(value: unknown, keyPath: string[]): StoreKey | null {
    const key: StoreKey = [];
    for (const path of keyPath) {
        const part = readPath(value, path);
        if (typeof part !== "string" && typeof part !== "number") return null;
        key.push(part);
    }
    return key;
}
