import { describe, expect, test } from "bun:test";
import { normalizeView, transitionView, libraryViewKey } from "./view";
import { DIFFICULTY_RANGE, QUALITY_RANGE, YEAR_RANGE } from "./filters";

describe("library view rules", () => {
    test("tab-specific validation removes irrelevant filters and defaults", () => {
        expect(normalizeView({ tab: "series", filters: { isOfficial: false, topic: ["A"], seriesId: 7 } }))
            .toEqual({ tab: "series", filters: { isOfficial: false } });
        expect(normalizeView({ tab: "problems", filters: {
            topic: ["bad", "G", "A", "G"], mastery: ["learning"],
            difficulty: DIFFICULTY_RANGE, quality: QUALITY_RANGE, verified: false,
        } })).toEqual({ tab: "problems", filters: { topic: ["A", "G"], verified: false, mastery: ["learning"] } });
        expect(normalizeView({ tab: "tests", filters: { year: YEAR_RANGE } }).filters).toEqual({});
    });

    test("historical series may predate the default global year slider", () => {
        expect(normalizeView({ tab: "problems", filters: { seriesId: 7, year: [1938, 1940] } }).filters)
            .toEqual({ seriesId: 7, year: [1938, 1940] });
    });

    test("unscoped dimensions are removed, while test-only number ranges survive", () => {
        expect(normalizeView({ tab: "problems", filters: {
            divisions: ["A"], formats: ["Sprint"], year: [2020, 2024], problemNumbers: [1, 5],
        } }).filters).toEqual({});
        expect(normalizeView({ tab: "problems", filters: {
            testId: 9, divisions: ["A"], formats: ["Sprint"], year: [2020, 2024], problemNumbers: [1, 5],
        } }).filters).toEqual({ testId: 9, problemNumbers: [1, 5] });
    });

    test("changing series clears dependent filters atomically", () => {
        const original = normalizeView({ tab: "problems", filters: {
            seriesId: 7, testId: 9, problemNumbers: [21, 25], topic: ["A"],
        } });
        expect(transitionView(original, { type: "patch", filters: { seriesId: 8 } }))
            .toEqual({ tab: "problems", filters: { seriesId: 8, topic: ["A"] } });
        expect(original.filters).toEqual({ seriesId: 7, testId: 9, problemNumbers: [21, 25], topic: ["A"] });
        const tests = normalizeView({ tab: "tests", filters: { seriesId: 7, divisions: ["A"], formats: ["Sprint"], year: [2020, 2024] } });
        expect(transitionView(tests, { type: "patch", filters: { seriesId: 8 } }).filters).toEqual({ seriesId: 8 });
    });

    test("clear preserves search and scope; scope removal cascades", () => {
        const view = normalizeView({ tab: "problems", filters: { search: "42", seriesId: 7, testId: 9, topic: ["A"], problemNumbers: [3, 5] } });
        expect(transitionView(view, { type: "clear-filters" }).filters).toEqual({ search: "42", seriesId: 7, testId: 9 });
        expect(transitionView(view, { type: "clear-scope", scope: "test" }).filters).toEqual({ search: "42", seriesId: 7, topic: ["A"] });
        expect(transitionView(view, { type: "clear-scope", scope: "series" }).filters).toEqual({ search: "42", topic: ["A"] });
    });

    test("drilling and tab changes start fresh; reselecting the active tab preserves filters", () => {
        const view = normalizeView({ tab: "problems", filters: { topic: ["A"], search: "42" } });
        expect(transitionView(view, { type: "tab", tab: "problems" })).toBe(view);
        expect(transitionView(view, { type: "tab", tab: "tests" })).toEqual({ tab: "tests", filters: {} });
        expect(transitionView(view, { type: "series", seriesId: 7 })).toEqual({ tab: "tests", filters: { seriesId: 7 } });
        expect(transitionView(view, { type: "test", testId: 9 })).toEqual({ tab: "problems", filters: { testId: 9 } });
    });

    test("query identity is independent of selection ordering and duplicates", () => {
        expect(libraryViewKey({ tab: "problems", filters: { topic: ["G", "A", "G"] } }))
            .toBe(libraryViewKey({ tab: "problems", filters: { topic: ["A", "G"] } }));
    });
});
