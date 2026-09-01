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

describe("LibraryStore series scope", () => {
    test("drops division scope when seriesId is cleared", () => {
        const store = new LibraryStore();
        store.patchFilters({ seriesId: 7, divisions: ["A"], formats: ["Sprint"] });
        store.patchFilters({ seriesId: undefined, problemNumbers: [21, 25] });
        expect(store.current.filters).toEqual({});
    });

    test("drops division and format when a test is locked", () => {
        const store = new LibraryStore();
        store.patchFilters({
            seriesId: 7,
            testId: 9,
            divisions: ["A"],
            formats: ["Sprint"],
            problemNumbers: [21, 25],
        });
        expect(store.current.filters).toEqual({
            seriesId: 7,
            testId: 9,
            problemNumbers: [21, 25],
        });
    });

    test("compares problem-number ranges by value", () => {
        const store = new LibraryStore();
        store.patchFilters({ seriesId: 7, problemNumbers: [21, 25] });
        const original = store.current.filters;
        store.patchFilters({ seriesId: 7, problemNumbers: [21, 25] });
        expect(store.current.filters).toBe(original);
    });

    test("keeps a year filter when seriesId is cleared", () => {
        const store = new LibraryStore();
        store.patchFilters({ seriesId: 7, year: [2010, 2024] });
        store.patchFilters({ seriesId: undefined, year: [2010, 2024] });
        expect(store.current.filters).toEqual({ year: [2010, 2024] });
    });

    test("drops year when a test is locked", () => {
        const store = new LibraryStore();
        store.patchFilters({
            seriesId: 7,
            testId: 9,
            year: [2010, 2024],
        });
        expect(store.current.filters).toEqual({
            seriesId: 7,
            testId: 9,
        });
    });
});
