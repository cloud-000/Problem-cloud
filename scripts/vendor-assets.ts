/**
 * Vendor every critical rendering asset into `static/`.
 *
 * Offline mode's first rule (`docs/offline.md` §4) is that a downloaded problem
 * must render with no network at all. Before this script, `app.html` pulled
 * KaTeX from jsDelivr and Material Symbols from Google Fonts, and `layout.css`
 * `@import`ed Inter / JetBrains Mono / Source Serif 4 from Google Fonts — so an
 * offline problem lost its math, its icons, and its typography. Self-hosting is
 * therefore a prerequisite for the service worker, not a nicety: the worker can
 * only precache same-origin build/static assets.
 *
 * The output is **not committed** (`static/fonts/` and `static/vendor/` are
 * gitignored), so this script is part of the build rather than a one-off
 * maintenance chore:
 *
 * - `bun run build` runs it with `--if-missing` and **fails** if it cannot
 *   produce the assets. A build that silently shipped without them would render
 *   every problem with no math, no icons, and the wrong typeface.
 * - `bun install` runs it the same way through `prepare`, tolerating failure, so
 *   a fresh clone is usable without a separate step but an offline `install`
 *   still succeeds.
 * - `bun scripts/vendor-assets.ts` with no flag always re-downloads, which is
 *   how you pick up a new KaTeX version or a changed font request.
 *
 * `--if-missing` is a real check, not a directory-exists test: it verifies every
 * font each vendored stylesheet references and that the icon subset still covers
 * the icons `src/` uses. A half-populated `static/` is the failure mode worth
 * catching, because it looks fine until one glyph is blank.
 *
 * Only **woff2** is vendored. The v1 release gate is Chromium 111+ / Safari
 * 16.4+ (`docs/offline-contracts.md` §9), and every one of those supports woff2,
 * so the woff/ttf fallbacks KaTeX's stylesheet lists would triple the vendored
 * font payload to serve browsers we do not support. The KaTeX CSS is rewritten
 * accordingly rather than left pointing at files we did not fetch.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    MATERIAL_SYMBOLS_CSS,
    MATERIAL_SYMBOLS_CSS_PATH,
    MATERIAL_SYMBOLS_FONT,
    MATERIAL_SYMBOLS_FONT_PATH,
    MODERN_UA,
    readSubsetManifest,
    usedIconNames,
    vendorMaterialSymbols,
} from "./icon-subset";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const STATIC = join(root, "static");

/** Pinned to the version `app.html` loaded from the CDN before vendoring. */
export const KATEX_VERSION = "0.17.0";
const KATEX_CDN = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist`;

/**
 * Google serves one `@font-face` per unicode subset. The app is an English
 * math-problem UI; keeping the Cyrillic/Greek/Vietnamese cuts would roughly
 * quadruple the vendored bytes for text no problem statement contains. Math
 * itself is typeset by KaTeX's own fonts, not these.
 */
const KEPT_SUBSETS = new Set(["latin", "latin-ext"]);

const TEXT_FONTS_URL =
    "https://fonts.googleapis.com/css2" +
    "?family=Inter:wght@300;400;500;600;700" +
    "&family=JetBrains+Mono:wght@400;500;600" +
    "&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900" +
    "&display=swap";

async function get(url: string): Promise<Response> {
    const res = await fetch(url, { headers: { "User-Agent": MODERN_UA } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res;
}

function write(relative: string, data: string | Uint8Array): number {
    const path = join(STATIC, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data as never);
    return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

async function writeBinary(relative: string, url: string): Promise<number> {
    const res = await get(url);
    return write(relative, new Uint8Array(await res.arrayBuffer()));
}

// --- KaTeX -------------------------------------------------------------------

/**
 * Drop every non-woff2 `src` entry from a `@font-face` block. KaTeX writes
 * `src: url(...woff2) format('woff2'), url(...woff) format('woff'), ...`; we
 * keep only the first pair so the stylesheet never references a file we did not
 * vendor (which offline would surface as a silently unstyled formula).
 */
export function woff2Only(css: string): string {
    // Minified CSS ends the last declaration of a block with `}` rather than
    // `;`, and quotes `format(…)` either way, so both terminators and both
    // quote styles have to be tolerated here.
    return css.replace(/src:([^;}]*)([;}])/g, (whole, body: string, end: string) => {
        const woff2 = body
            .split(",")
            .map((part) => part.trim())
            .filter((part) => /format\(\s*["']?woff2["']?\s*\)/.test(part));
        return woff2.length ? `src:${woff2.join(",")}${end}` : whole;
    });
}

/** Every `fonts/KaTeX_*.woff2` the stylesheet references, deduplicated. */
export function katexFontFiles(css: string): string[] {
    const names = new Set<string>();
    for (const m of css.matchAll(/url\(fonts\/([A-Za-z0-9_\-.]+\.woff2)\)/g)) {
        names.add(m[1]);
    }
    return [...names].sort();
}

async function vendorKatex(): Promise<number> {
    const rawCss = await (await get(`${KATEX_CDN}/katex.min.css`)).text();
    const css = woff2Only(rawCss);
    let bytes = write("vendor/katex/katex.min.css", css);

    bytes += await writeBinary(
        "vendor/katex/katex.min.js",
        `${KATEX_CDN}/katex.min.js`,
    );
    bytes += await writeBinary(
        "vendor/katex/auto-render.min.js",
        `${KATEX_CDN}/contrib/auto-render.min.js`,
    );

    const fonts = katexFontFiles(css);
    if (fonts.length === 0) {
        throw new Error("KaTeX stylesheet referenced no woff2 fonts");
    }
    for (const font of fonts) {
        bytes += await writeBinary(
            `vendor/katex/fonts/${font}`,
            `${KATEX_CDN}/fonts/${font}`,
        );
    }
    console.log(`katex ${KATEX_VERSION}: ${fonts.length} fonts, ${bytes} bytes`);
    return bytes;
}

// --- Text fonts --------------------------------------------------------------

/** One `@font-face` block from a Google Fonts stylesheet, with its subset label. */
export type FontFace = { subset: string; block: string; url: string };

/**
 * Split a Google Fonts stylesheet into labelled `@font-face` blocks. Google
 * writes the subset name as a comment immediately above each block (`/* latin *​/`),
 * which is the only machine-readable handle on which cut a block covers.
 */
export function parseFontFaces(css: string): FontFace[] {
    const faces: FontFace[] = [];
    const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
    for (const m of css.matchAll(re)) {
        const url = m[2].match(/url\(([^)]+)\)/)?.[1];
        if (url) faces.push({ subset: m[1], block: m[2], url });
    }
    return faces;
}

/** Stable local file name for one remote font file. */
export function localFontName(face: FontFace): string {
    const family =
        face.block
            .match(/font-family:\s*'([^']+)'/)?.[1]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-") ?? "font";
    const weight =
        face.block.match(/font-weight:\s*([^;]+);/)?.[1].trim().replace(/\s+/g, "-") ??
        "400";
    const style = face.block.includes("font-style: italic") ? "italic" : "normal";
    return `${family}-${weight}-${style}-${face.subset}.woff2`;
}

async function vendorTextFonts(): Promise<number> {
    const css = await (await get(TEXT_FONTS_URL)).text();
    const faces = parseFontFaces(css).filter((f) => KEPT_SUBSETS.has(f.subset));
    if (faces.length === 0) throw new Error("No latin font faces were returned");

    let bytes = 0;
    const blocks: string[] = [];
    for (const face of faces) {
        const name = localFontName(face);
        bytes += await writeBinary(`fonts/${name}`, face.url);
        blocks.push(
            `/* ${face.subset} */\n${face.block.replace(/url\([^)]+\)/, `url("/fonts/${name}")`)}`,
        );
    }

    const header = `/* Generated by scripts/vendor-assets.ts — do not edit.
   Vendored text faces (see docs/offline.md §4). Only the latin and latin-ext
   cuts are kept; woff2 only, which every supported browser reads. */\n\n`;
    bytes += write("fonts/text.css", header + blocks.join("\n\n") + "\n");
    console.log(`text fonts: ${faces.length} faces, ${bytes} bytes`);
    return bytes;
}

// --- Completeness check ------------------------------------------------------

/** Every referenced file in a vendored stylesheet that is not on disk. */
function missingReferences(
    cssPath: string,
    pattern: RegExp,
    resolve: (name: string) => string,
): string[] {
    if (!existsSync(join(STATIC, cssPath))) return [cssPath];
    const css = readFileSync(join(STATIC, cssPath), "utf8");
    const missing: string[] = [];
    for (const match of css.matchAll(pattern)) {
        const relative = resolve(match[1]);
        if (!existsSync(join(STATIC, relative))) missing.push(relative);
    }
    return missing;
}

/**
 * What a complete `static/` is missing, as human-readable paths. Empty means
 * every stylesheet, every font it names, and an icon subset covering `src/` are
 * all present — the condition `--if-missing` skips the download on.
 */
export function missingAssets(): string[] {
    const missing: string[] = [];

    for (const file of [
        "vendor/katex/katex.min.js",
        "vendor/katex/auto-render.min.js",
    ]) {
        if (!existsSync(join(STATIC, file))) missing.push(file);
    }
    missing.push(
        ...missingReferences(
            "vendor/katex/katex.min.css",
            /url\(fonts\/([A-Za-z0-9_\-.]+\.woff2)\)/g,
            (name) => `vendor/katex/fonts/${name}`,
        ),
    );
    missing.push(
        ...missingReferences(
            "fonts/text.css",
            /url\("\/fonts\/([^"]+)"\)/g,
            (name) => `fonts/${name}`,
        ),
    );

    if (!existsSync(MATERIAL_SYMBOLS_CSS)) missing.push(MATERIAL_SYMBOLS_CSS_PATH);
    const manifest = readSubsetManifest();
    if (!manifest) {
        missing.push("scripts/material-symbols-subset.json");
    } else if (
        !existsSync(MATERIAL_SYMBOLS_FONT) ||
        statSync(MATERIAL_SYMBOLS_FONT).size !== manifest.bytes
    ) {
        // A size mismatch means a truncated or stale download, which renders as
        // blank space rather than as an error.
        missing.push(MATERIAL_SYMBOLS_FONT_PATH);
    } else {
        const listed = new Set(manifest.names);
        const uncovered = usedIconNames().filter((name) => !listed.has(name));
        if (uncovered.length > 0) {
            missing.push(`${uncovered.length} icon glyph(s): ${uncovered.join(", ")}`);
        }
    }

    return missing;
}

// --- Entry point -------------------------------------------------------------

if (import.meta.main) {
    const missing = missingAssets();

    if (process.argv.includes("--if-missing") && missing.length === 0) {
        console.log("Vendored assets are complete; nothing to download.");
    } else {
        if (missing.length > 0) {
            console.log(`Vendoring assets (missing: ${missing.join(", ")})`);
        }
        let bytes = await vendorKatex();
        bytes += await vendorTextFonts();
        const symbols = await vendorMaterialSymbols();
        bytes += symbols.bytes;
        console.log(
            `material symbols: ${symbols.names.length} icons, ${symbols.bytes} bytes`,
        );
        console.log(`\nvendored ${(bytes / 1024).toFixed(0)} KiB into static/`);

        const stillMissing = missingAssets();
        if (stillMissing.length > 0) {
            throw new Error(
                `Vendoring finished but static/ is still incomplete: ${stillMissing.join(", ")}`,
            );
        }
    }
}
