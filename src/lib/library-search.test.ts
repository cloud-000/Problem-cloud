import { describe, expect, test } from "bun:test";
import { parseLibrarySearchIds } from "$lib/library";

describe("Library exact-id search", () => {
    test("parses comma- and whitespace-separated positive ids", () => {
        expect(parseLibrarySearchIds("42, 108\n316")).toEqual([42, 108, 316]);
    });

    test("deduplicates ids while preserving query order", () => {
        expect(parseLibrarySearchIds("8 3 8 5")).toEqual([8, 3, 5]);
    });

    test("leaves names and invalid ids for name-search or empty handling", () => {
        expect(parseLibrarySearchIds("AMC 10A")).toBeNull();
        expect(parseLibrarySearchIds("0, 2")).toBeNull();
        expect(parseLibrarySearchIds("   ")).toBeNull();
    });
});
