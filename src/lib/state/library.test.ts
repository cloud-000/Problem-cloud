import { describe, expect, test } from "bun:test";

Object.assign(globalThis, { $state: <T>(value: T): T => value });
const { LibraryStore } = await import("./library.svelte");

describe("embedded library state", () => {
    test("instances stay independent and use the same transitions as URL navigation", () => {
        const tour = new LibraryStore();
        const other = new LibraryStore();
        tour.dispatch({ type: "series", seriesId: 7 });
        tour.dispatch({ type: "test", testId: 9, seriesId: 7 });
        tour.dispatch({ type: "patch", filters: { topic: ["G"], problemNumbers: [21, 25] } });
        tour.dispatch({ type: "clear-filters" });
        expect(tour.view).toEqual({ tab: "problems", filters: { seriesId: 7, testId: 9 } });
        expect(other.view).toEqual({ tab: "problems", filters: {} });
    });
});
