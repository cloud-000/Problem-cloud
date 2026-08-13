import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    katexFontFiles,
    localFontName,
    missingAssets,
    parseFontFaces,
    woff2Only,
} from "./vendor-assets";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(root, "static");

describe("the KaTeX stylesheet rewrite", () => {
    test("keeps woff2 and drops the fallbacks we did not vendor", () => {
        // Minified CSS: double-quoted `format(...)`, and the last declaration in
        // a block ends with `}` rather than `;`. Both broke the first attempt.
        const css =
            '@font-face{font-family:KaTeX_AMS;src:url(fonts/A.woff2) format("woff2"),url(fonts/A.woff) format("woff"),url(fonts/A.ttf) format("truetype")}';
        const rewritten = woff2Only(css);
        expect(rewritten).toContain('url(fonts/A.woff2) format("woff2")');
        expect(rewritten).not.toContain(".woff)");
        expect(rewritten).not.toContain(".ttf)");
        expect(rewritten.endsWith("}")).toBe(true);
    });

    test("leaves a src it cannot satisfy alone rather than emptying it", () => {
        const css = "@font-face{src:url(a.ttf) format('truetype')}";
        expect(woff2Only(css)).toBe(css);
    });

    test("finds every font the stylesheet references", () => {
        expect(
            katexFontFiles(
                "src:url(fonts/A.woff2) format('woff2');src:url(fonts/B.woff2) format('woff2');src:url(fonts/A.woff2)",
            ),
        ).toEqual(["A.woff2", "B.woff2"]);
    });
});

describe("Google Fonts stylesheet parsing", () => {
    const css = `/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 300;
  src: url(https://fonts.gstatic.com/s/inter/v20/cyr.woff2) format('woff2');
  unicode-range: U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Source Serif 4';
  font-style: italic;
  font-weight: 200 900;
  src: url(https://fonts.gstatic.com/s/serif/v1/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

    test("labels each face with the subset comment above it", () => {
        const faces = parseFontFaces(css);
        expect(faces.map((face) => face.subset)).toEqual(["cyrillic", "latin"]);
        expect(faces[1].url).toBe("https://fonts.gstatic.com/s/serif/v1/lat.woff2");
    });

    test("names a local file by family, weight, style and subset", () => {
        const [, serif] = parseFontFaces(css);
        expect(localFontName(serif)).toBe("source-serif-4-200-900-italic-latin.woff2");
    });
});

describe("the vendored output", () => {
    test("is complete — every stylesheet, every font it names, every glyph", () => {
        // The output is gitignored and produced by `prepare` / `build`, so this
        // asserts the build step actually ran. A half-populated `static/` looks
        // fine until one formula or one icon renders blank.
        expect(missingAssets()).toEqual([]);
    });

    test("finds a deleted font rather than trusting the directory exists", () => {
        // The check has to be per-file: KaTeX's stylesheet naming a font that is
        // not on disk is exactly the failure `--if-missing` must not skip past.
        const css = readFileSync(join(STATIC, "vendor/katex/katex.min.css"), "utf8");
        const fonts = katexFontFiles(css);
        expect(fonts.length).toBeGreaterThan(0);
        for (const font of fonts) {
            expect(existsSync(join(STATIC, "vendor/katex/fonts", font))).toBe(true);
        }
    });

    test("references no third-party origin", () => {
        for (const file of ["vendor/katex/katex.min.css", "fonts/text.css"]) {
            const css = readFileSync(join(STATIC, file), "utf8");
            expect(css).not.toContain("fonts.gstatic.com");
            expect(css).not.toContain("cdn.jsdelivr.net");
        }
    });
});
