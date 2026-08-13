import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
    APP_HTML,
    MATERIAL_SYMBOLS_CSS,
    MATERIAL_SYMBOLS_FONT,
    MATERIAL_SYMBOLS_FONT_PATH,
    knownIconNames,
    materialSymbolsCss,
    readSubsetManifest,
    subsetUrl,
    usedIconNames,
} from "./icon-subset";

describe("material symbols subset", () => {
    test("the vendored subset lists every icon name used in src", () => {
        const manifest = readSubsetManifest();
        expect(manifest).not.toBeNull();

        const listed = new Set(manifest!.names);
        const missing = usedIconNames().filter((name) => !listed.has(name));

        // A name absent from the subset renders as blank space, not a fallback
        // glyph, so this is the difference between a working icon and an
        // invisible one. Run `bun scripts/icon-subset.ts --write` to fix.
        expect(missing).toEqual([]);
    });

    test("the manifest describes the font file actually committed", () => {
        const manifest = readSubsetManifest()!;
        expect(existsSync(MATERIAL_SYMBOLS_FONT)).toBe(true);
        // A truncated or re-downloaded-but-not-committed font is the failure
        // this catches: the glyph list would still look right.
        expect(statSync(MATERIAL_SYMBOLS_FONT).size).toBe(manifest.bytes);
        expect(manifest.source).toBe(subsetUrl(manifest.names));
    });

    test("the vendored stylesheet matches the generator and points at the font", () => {
        const css = readFileSync(MATERIAL_SYMBOLS_CSS, "utf8");
        expect(css).toBe(materialSymbolsCss());
        expect(css).toContain(`/${MATERIAL_SYMBOLS_FONT_PATH}`);
    });

    test("app.html loads no font or math asset from a third-party origin", () => {
        // Offline mode's precondition (docs/offline.md §4): a service worker can
        // only precache same-origin assets, so a CDN link here is an offline
        // problem that renders without math, icons, or its typography.
        const html = readFileSync(APP_HTML, "utf8");
        expect(html).not.toContain("fonts.googleapis.com");
        expect(html).not.toContain("fonts.gstatic.com");
        expect(html).not.toContain("cdn.jsdelivr.net");
        expect(html).toContain("/vendor/katex/katex.min.css");
        expect(html).toContain(`/${MATERIAL_SYMBOLS_FONT_PATH.replace(".woff2", ".css")}`);
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
