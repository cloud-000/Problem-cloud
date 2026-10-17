import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ICON_AXES, iconHref, iconVariantId } from "../src/lib/components/icon/assets";
import { APP_HTML, ICON_DIRECTORY, ICON_SOURCE, iconRequirements, knownIconNames, missingIconAssets, readSubsetManifest, svgSymbol, upstreamIconUrl, usedIconNames } from "./icon-subset";

describe("Material Symbols SVG assets", () => {
    test("every dynamic icon and explicit axis instance has intact local artwork", () => {
        expect(missingIconAssets()).toEqual([]);
        const requirements = iconRequirements();
        expect(requirements.get("check")?.map(iconVariantId)).toContain("w400-g0-o20-f1");
        expect(requirements.get("expand_more")?.map(iconVariantId)).toContain("w400-g0-o20-f0");
        expect(requirements.get("mark_email_unread")?.map(iconVariantId)).toContain("w500-g0-o24-f0");
        expect(usedIconNames()).toContain("ink_eraser");
        expect(usedIconNames()).toContain("check_circle");
        expect(usedIconNames()).toContain("home");
        expect(knownIconNames().size).toBeGreaterThan(4000);
    });

    test("the generated manifest describes independently loadable icons", () => {
        const manifest = readSubsetManifest()!;
        expect(manifest.source).toBe(ICON_SOURCE);
        expect(manifest.bytes).toBe(manifest.files.reduce((n, f) => n + f.bytes, 0));
        for (const file of manifest.files) {
            const svg = readFileSync(join(ICON_DIRECTORY, `${file.name}.svg`), "utf8");
            expect(Buffer.byteLength(svg)).toBe(file.bytes);
            for (const id of file.variants) expect(svg).toContain(`id="${id}"`);
            expect(svg).not.toContain("<script");
        }
    });

    test("only emits path geometry, including older SVGs without viewBox", () => {
        expect(svgSymbol('<svg width="24" height="24"><path d="M0 0h24v24Z"/></svg>', "test"))
            .toContain('viewBox="0 0 24 24"');
        expect(() => svgSymbol('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>', "test")).toThrow();
    });

    test("uses exact fill/weight/optical-size instances and rejects malformed names", () => {
        expect(iconHref("home", DEFAULT_ICON_AXES)).toBe("/vendor/material-symbols/home.svg#w400-g0-o24-f0");
        expect(iconHref("../home", DEFAULT_ICON_AXES)).toBe("");
        expect(upstreamIconUrl("check", { ...DEFAULT_ICON_AXES, fill: true, opticalSize: 20 }))
            .toEndWith("/check_fill1_20px.svg");
        expect(upstreamIconUrl("home", { ...DEFAULT_ICON_AXES, weight: 500, grade: -25, fill: true }))
            .toEndWith("/home_wght500gradN25fill1_24px.svg");
    });

    test("the document loads no icon font or third-party rendering assets", () => {
        const html = readFileSync(APP_HTML, "utf8");
        for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"]) expect(html).not.toContain(host);
        expect(html).toContain("/vendor/katex/katex.min.css");
        expect(html).not.toContain("material-symbols-rounded.css");
        expect(html).not.toContain("source-serif-4-200-900-normal-latin.woff2");
        expect(html).toContain("inter-300-700-normal-latin.woff2");
    });
});
