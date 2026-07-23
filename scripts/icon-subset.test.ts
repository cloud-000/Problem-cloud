import { describe, expect, test } from "bun:test";
import { currentUrl, knownIconNames, subsetUrl, usedIconNames } from "./icon-subset";

describe("material symbols subset", () => {
    test("app.html lists every icon name used in src", () => {
        const url = currentUrl();
        expect(url).not.toBeNull();

        const listed = new Set(
            new URL(url!).searchParams.get("icon_names")?.split(",") ?? [],
        );
        const missing = usedIconNames().filter((name) => !listed.has(name));

        // A name absent from the subset renders as blank space, not a fallback
        // glyph, so this is the difference between a working icon and an
        // invisible one. Run `bun scripts/icon-subset.ts --write` to fix.
        expect(missing).toEqual([]);
    });

    test("app.html url matches what the generator produces", () => {
        expect(currentUrl()).toBe(subsetUrl(usedIconNames()));
    });

    test("extraction finds the icons that are only reachable dynamically", () => {
        const names = usedIconNames();
        // `SEVERITY_ICON[severity]` in toast.svelte and `tool.icon` in the
        // whiteboard toolbar never appear next to an `<Icon>` tag — they are
        // why extraction scans every string literal rather than call sites.
        expect(names).toContain("check_circle");
        expect(names).toContain("ink_eraser");
    });

    test("a short string value before an icon literal does not hide it", () => {
        // Regression: `{ href: "/", icon: "home" }` in the app-shell nav. A
        // length-bounded string regex skipped the 1-char `"/"` and swallowed
        // `home` as an inter-quote span, so the nav's Home icon shipped blank.
        expect(usedIconNames()).toContain("home");
    });

    test("the vendored glyph list covers the full font", () => {
        expect(knownIconNames().size).toBeGreaterThan(4000);
    });
});
