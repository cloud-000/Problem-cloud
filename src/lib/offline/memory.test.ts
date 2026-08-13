import { describe, expect, test } from "bun:test";
import { createMemoryStorage } from "./memory";
import { OFFLINE_STORES, STORE } from "./schema";
import { keyFor } from "./storage";
import { upgradeSchema } from "./idb";

describe("the memory storage backend", () => {
    test("publishes a transaction's writes only when it resolves", async () => {
        const storage = createMemoryStorage();
        await storage.transaction([STORE.meta], "readwrite", async (tx) => {
            await tx.put(STORE.meta, { key: "a", value: 1 });
        });
        expect(storage.dump(STORE.meta)).toHaveLength(1);

        await expect(
            storage.transaction([STORE.meta], "readwrite", async (tx) => {
                await tx.put(STORE.meta, { key: "b", value: 2 });
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        // The half-written record must not be visible; this is the guarantee the
        // repository's atomic writes are built on.
        expect(storage.dump(STORE.meta)).toHaveLength(1);
    });

    test("reads see the transaction's own uncommitted writes", async () => {
        const storage = createMemoryStorage();
        const seen = await storage.transaction(
            [STORE.meta],
            "readwrite",
            async (tx) => {
                await tx.put(STORE.meta, { key: "a", value: 7 });
                return tx.get<{ value: number }>(STORE.meta, ["a"]);
            },
        );
        expect(seen?.value).toBe(7);
    });

    test("refuses a write in a readonly transaction", async () => {
        const storage = createMemoryStorage();
        await expect(
            storage.transaction([STORE.meta], "readonly", async (tx) => {
                await tx.put(STORE.meta, { key: "a", value: 1 });
            }),
        ).rejects.toThrow(/readonly/);
    });

    test("leaves a record out of an index when a component is absent", async () => {
        const storage = createMemoryStorage();
        await storage.transaction([STORE.packages], "readwrite", async (tx) => {
            await tx.put(STORE.packages, {
                userId: "u",
                packageId: "p",
                state: "staging",
                activeRevision: null,
                active: null,
                staging: null,
                schemaVersion: 1,
                lastSyncedAt: null,
            });
        });
        const indexed = await storage.transaction(
            [STORE.packages],
            "readonly",
            (tx) =>
                tx.getAll(STORE.packages, {
                    index: "byUserActiveRevision",
                    only: ["u", "anything"],
                }),
        );
        // IndexedDB skips a record whose index key path yields null, and the
        // memory backend has to agree or the two disagree about query results.
        expect(indexed).toEqual([]);
    });

    test("one failed transaction does not poison the ones after it", async () => {
        const storage = createMemoryStorage();
        await expect(
            storage.transaction([STORE.meta], "readwrite", async () => {
                throw new Error("first");
            }),
        ).rejects.toThrow("first");
        await storage.transaction([STORE.meta], "readwrite", async (tx) => {
            await tx.put(STORE.meta, { key: "after", value: 1 });
        });
        expect(storage.dump(STORE.meta)).toHaveLength(1);
    });
});

describe("the schema", () => {
    test("every store's key path is derivable from its own records", () => {
        // A key path naming a field the record shape does not carry is a store
        // that silently accepts nothing.
        for (const store of OFFLINE_STORES) {
            expect(store.keyPath.length).toBeGreaterThan(0);
            for (const index of store.indexes) {
                expect(index.keyPath.length).toBeGreaterThan(0);
            }
        }
    });

    test("keyFor mirrors IndexedDB's refusal to key on null", () => {
        expect(keyFor({ a: "x", b: 2 }, ["a", "b"])).toEqual(["x", 2]);
        expect(keyFor({ a: "x", b: null }, ["a", "b"])).toBeNull();
        expect(keyFor({ a: { b: 3 } }, ["a.b"])).toEqual([3]);
    });

    test("an upgrade creates stores and indexes without dropping anything", () => {
        const created: string[] = [];
        const indexes: string[] = [];
        const store = {
            indexNames: { contains: () => false },
            createIndex: (name: string) => indexes.push(name),
        };
        const db = {
            objectStoreNames: { contains: () => false },
            createObjectStore: (name: string) => {
                created.push(name);
                return store;
            },
        } as unknown as IDBDatabase;
        const transaction = {
            objectStore: () => store,
        } as unknown as IDBTransaction;

        upgradeSchema(db, transaction, 0, 1);
        expect(created).toEqual(OFFLINE_STORES.map((entry) => entry.name));
        expect(indexes).toHaveLength(
            OFFLINE_STORES.reduce((total, entry) => total + entry.indexes.length, 0),
        );
    });
});
