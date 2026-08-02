import { describe, expect, test } from "bun:test";

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, {
    $state: state,
    $derived: <T>(value: T): T => value,
});

const { LibraryStore } = await import("./library.svelte");

describe("LibraryStore.patchFilters", () => {
    test("does not replace filters for a semantically unchanged patch", () => {
        const store = new LibraryStore();
        const original = store.current.filters;

        store.patchFilters({
            seriesId: undefined,
            topic: [],
            isComputational: null,
            verified: null,
        });

        expect(store.current.filters).toBe(original);
    });

    test("compares array filters by value before replacing filters", () => {
        const store = new LibraryStore();
        store.patchFilters({ topic: ["algebra", "geometry"] });
        const original = store.current.filters;

        store.patchFilters({ topic: ["algebra", "geometry"] });

        expect(store.current.filters).toBe(original);
    });

    test("replaces filters when their effective value changes", () => {
        const store = new LibraryStore();
        const original = store.current.filters;

        store.patchFilters({ topic: ["algebra"] });

        expect(store.current.filters).not.toBe(original);
        expect(store.current.filters).toEqual({ topic: ["algebra"] });
    });
});
