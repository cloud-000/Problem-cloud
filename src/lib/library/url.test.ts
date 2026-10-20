import { describe, expect, test } from "bun:test";
import { parseLibraryUrl, writeLibraryUrl } from "./url";
import { normalizeView, type LibraryView } from "./view";

const parse = (query: string) => parseLibraryUrl(new URLSearchParams(query));

describe("library URL contract", () => {
    test("old search links and invalid tabs land on Problems", () => {
        expect(parse("search=42%2C108")).toEqual({ tab: "problems", filters: { search: "42,108" } });
        expect(parse("tab=unknown&topic=A")).toEqual({ tab: "problems", filters: { topic: ["A"] } });
    });

    test("malformed scalars, ranges and enum members are ignored", () => {
        expect(parse("series=-1&test=1e3&rating=1800..1200&quality=0..101&verified=0&computational=no&topic=unknown&mastery=no&plan=no"))
            .toEqual({ tab: "problems", filters: {} });
        expect(parse("test=9007199254740992&rating=NaN..50&problemNumbers=0..2").filters).toEqual({});
        expect(parse("tab=series&official=false").filters).toEqual({ isOfficial: false });
        expect(parse("verified=false&computational=true").filters).toEqual({ isComputational: true, verified: false });
    });

    test("all active fields round-trip without splitting freeform strings", () => {
        const views: LibraryView[] = [
            { tab: "series", filters: { search: "AMC", isOfficial: false } },
            { tab: "tests", filters: { search: "2024", seriesId: 7, divisions: ["A"], formats: ["Sprint"], year: [2020, 2024], type: ["math contest"], isComputational: false } },
            { tab: "problems", filters: { search: "42,108", seriesId: 7, divisions: ["B", "A"], formats: ["Sprint"], year: [2020, 2024], problemNumbers: [15, 25], topic: ["G", "A"], tags: ["a,b", "x & y", "日本語"], difficulty: [1200, 1800], quality: [20, 80], isComputational: true, verified: false, mastery: ["unassessed", "learning"], engagement: ["none", "later"] } },
            { tab: "problems", filters: { testId: 91, problemNumbers: [5, 5] } },
        ];
        for (const view of views) {
            const url = writeLibraryUrl(new URL("https://example.test/library"), view);
            expect(parseLibraryUrl(url.searchParams)).toEqual(normalizeView(view));
        }
    });

    test("rewriting removes stale owned parameters and preserves unrelated state", () => {
        const current = new URL("https://example.test/library?tab=tests&series=7&tag=old&ref=home#results");
        const next = writeLibraryUrl(current, { tab: "problems", filters: { topic: ["G", "A", "G"] } });
        expect(next.pathname).toBe("/library");
        expect(next.hash).toBe("#results");
        expect(next.searchParams.get("ref")).toBe("home");
        expect(next.searchParams.get("tab")).toBeNull();
        expect(next.searchParams.get("series")).toBeNull();
        expect(next.searchParams.getAll("topic")).toEqual(["A", "G"]);
        expect(next.searchParams.getAll("tag")).toEqual([]);
        expect(current.searchParams.get("series")).toBe("7");
        expect(writeLibraryUrl(next, parseLibraryUrl(next.searchParams)).href).toBe(next.href);
    });
});
