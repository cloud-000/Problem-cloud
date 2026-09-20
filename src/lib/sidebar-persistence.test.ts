import { describe, expect, test } from "bun:test";
import {
    loadSidebarExpanded,
    saveSidebarExpanded,
    loadSidebarWidth,
    saveSidebarWidth,
    DEFAULT_SIDEBAR_WIDTH,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    SIDEBAR_EXPANDED_STORAGE_KEY,
    SIDEBAR_WIDTH_STORAGE_KEY,
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

    test("tolerates unavailable storage for expanded state", () => {
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

    test("defaults to DEFAULT_SIDEBAR_WIDTH when no width preference exists", () => {
        expect(loadSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
        expect(loadSidebarWidth({ getItem: () => null })).toBe(DEFAULT_SIDEBAR_WIDTH);
    });

    test("restores valid persisted width and clamps to constraints", () => {
        expect(loadSidebarWidth({ getItem: () => '{"width":320}' })).toBe(320);
        // Direct number string
        expect(loadSidebarWidth({ getItem: () => "300" })).toBe(300);
        // Clamping below min
        expect(loadSidebarWidth({ getItem: () => '{"width":100}' })).toBe(MIN_SIDEBAR_WIDTH);
        // Clamping above max
        expect(loadSidebarWidth({ getItem: () => '{"width":900}' })).toBe(MAX_SIDEBAR_WIDTH);
        // Fallback for invalid json
        expect(loadSidebarWidth({ getItem: () => "not-json" })).toBe(DEFAULT_SIDEBAR_WIDTH);
    });

    test("saves the width state in json format", () => {
        let entry: [string, string] | undefined;

        saveSidebarWidth(
            {
                setItem: (key, value) => {
                    entry = [key, value];
                },
            },
            280,
        );

        expect(entry).toEqual([SIDEBAR_WIDTH_STORAGE_KEY, '{"width":280}']);
    });

    test("tolerates unavailable storage for width state", () => {
        expect(
            loadSidebarWidth({
                getItem: () => {
                    throw new Error("blocked");
                },
            }),
        ).toBe(DEFAULT_SIDEBAR_WIDTH);

        expect(() =>
            saveSidebarWidth(
                {
                    setItem: () => {
                        throw new Error("blocked");
                    },
                },
                300,
            ),
        ).not.toThrow();
    });
});
