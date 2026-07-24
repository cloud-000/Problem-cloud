import { describe, expect, test } from "bun:test";
import {
    loadSidebarExpanded,
    saveSidebarExpanded,
    SIDEBAR_EXPANDED_STORAGE_KEY,
} from "./sidebar-persistence";

describe("sidebar persistence", () => {
    test("defaults to expanded when no preference exists", () => {
        expect(loadSidebarExpanded(null)).toBe(true);
        expect(loadSidebarExpanded({ getItem: () => null })).toBe(true);
    });

    test("restores only an explicitly collapsed preference", () => {
        expect(loadSidebarExpanded({ getItem: () => "false" })).toBe(false);
        expect(loadSidebarExpanded({ getItem: () => "true" })).toBe(true);
        expect(loadSidebarExpanded({ getItem: () => "invalid" })).toBe(true);
    });

    test("saves the expanded state", () => {
        let entry: [string, string] | undefined;

        saveSidebarExpanded(
            {
                setItem: (key, value) => {
                    entry = [key, value];
                },
            },
            false,
        );

        expect(entry).toEqual([SIDEBAR_EXPANDED_STORAGE_KEY, "false"]);
    });

    test("tolerates unavailable storage", () => {
        expect(
            loadSidebarExpanded({
                getItem: () => {
                    throw new Error("blocked");
                },
            }),
        ).toBe(true);

        expect(() =>
            saveSidebarExpanded(
                {
                    setItem: () => {
                        throw new Error("blocked");
                    },
                },
                true,
            ),
        ).not.toThrow();
    });
});
