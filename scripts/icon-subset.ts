/**
 * Material Symbols subsetting.
 *
 * The app renders icons with Material Symbols Rounded. Requested without an
 * `icon_names` filter, the font is the *whole* variable face — all ~4200 glyphs
 * across four axes, 5.1 MB — on every cold load. Naming the icons we actually
 * use cuts it to a few hundred KB.
 *
 * The catch: an icon missing from the list renders as blank space, and icon
 * names reach `<Icon>` through data objects and dynamic props, so there is no
 * single syntactic form to scan for. Rather than pattern-match call sites, we
 * intersect every string literal in `src/` with the official glyph-name list
 * (`material-symbols-names.txt`). That over-collects — words like "code" and
 * "image" are both real strings and real icons — but over-collecting costs a
 * few KB while under-collecting ships an invisible icon, so the bias is
 * deliberate. Keep it.
 *
 * Offline mode moved the output from a Google Fonts `<link>` to a **vendored**
 * subset (`docs/offline.md` §4): the font file and its `@font-face` are written
 * into `static/fonts/`, and `material-symbols-subset.json` records which glyphs
 * that file was built from. The Google Fonts URL is now only the *source* the
 * subset is fetched from, never a runtime dependency.
 *
 * `bun scripts/icon-subset.ts` prints the current subset URL and reports drift;
 * `--write` re-downloads the subset and rewrites the vendored files.
 * `icon-subset.test.ts` fails if the manifest and the sources drift apart.
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const NAMES_FILE = join(here, "material-symbols-names.txt");
export const APP_HTML = join(root, "src", "app.html");

/** Where the vendored subset lives, relative to `static/`. */
export const MATERIAL_SYMBOLS_FONT_PATH = "fonts/material-symbols-rounded.woff2";
export const MATERIAL_SYMBOLS_CSS_PATH = "fonts/material-symbols-rounded.css";

export const MATERIAL_SYMBOLS_FONT = join(
    root,
    "static",
    MATERIAL_SYMBOLS_FONT_PATH,
);
export const MATERIAL_SYMBOLS_CSS = join(
    root,
    "static",
    MATERIAL_SYMBOLS_CSS_PATH,
);
/** Records the glyph set the vendored font file was actually built from. */
export const SUBSET_MANIFEST = join(here, "material-symbols-subset.json");

/** Axis ranges must stay in sync with what `icon/material.svelte` can set. */
const AXES = "opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

/** Every glyph name the Rounded variable font ships. */
export function knownIconNames(): Set<string> {
    return new Set(
        readFileSync(NAMES_FILE, "utf8")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
    );
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (/\.(svelte|ts|js)$/.test(entry)) out.push(path);
    }
    return out;
}

// Match whole string tokens with no length bound. A bounded content class
// (e.g. `{2,40}`) silently breaks quote pairing: a value too short to match —
// `"/"`, `""` — makes the scanner skip that opening quote and read the *next*
// string's contents as an inter-quote span, so `icon: "home"` after `href: "/"`
// is never seen. Intersecting with the glyph list below is the only filter we
// need, so the token itself carries no length limit.
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;
/** `<Icon>home</Icon>` — a bare text child, not a string literal. */
const ICON_CHILD = /<Icon\b[^>]*>\s*([a-z0-9_]+)\s*<\/Icon>/g;

/** Icon names referenced anywhere under `src/`, sorted. */
export function usedIconNames(): string[] {
    const known = knownIconNames();
    const found = new Set<string>();

    for (const file of sourceFiles(join(root, "src"))) {
        const source = readFileSync(file, "utf8");
        for (const m of source.matchAll(STRING_LITERAL)) {
            const value = (m[1] ?? m[2] ?? m[3]).trim();
            if (known.has(value)) found.add(value);
        }
        for (const m of source.matchAll(ICON_CHILD)) {
            if (known.has(m[1])) found.add(m[1]);
        }
    }
    return [...found].sort();
}

export function subsetUrl(names: string[]): string {
    // `display=block` because a swap period would flash raw glyph names
    // ("settings", "home") as text before the font lands.
    return (
        "https://fonts.googleapis.com/css2" +
        `?family=Material+Symbols+Rounded:${AXES}` +
        `&icon_names=${names.join(",")}` +
        "&display=block"
    );
}

/** The glyph set the vendored font file was built from. */
export type SubsetManifest = {
    /** Glyph names baked into the vendored file, sorted. */
    names: string[];
    /** The Google Fonts URL the file was fetched through (provenance only). */
    source: string;
    /** Size of the vendored woff2, so a truncated download is visible. */
    bytes: number;
};

export function readSubsetManifest(): SubsetManifest | null {
    if (!existsSync(SUBSET_MANIFEST)) return null;
    return JSON.parse(readFileSync(SUBSET_MANIFEST, "utf8")) as SubsetManifest;
}

/** The `@font-face` + utility class Google Fonts would have served, vendored. */
export function materialSymbolsCss(): string {
    return `/* Generated by scripts/icon-subset.ts — do not edit.
   Vendored Material Symbols Rounded subset (see docs/offline.md §4): the icon
   font must resolve with no network, so the Google Fonts stylesheet is baked
   out here and the subset itself lives beside this file. */
@font-face {
    font-family: "Material Symbols Rounded";
    font-style: normal;
    font-weight: 100 700;
    /* block, not swap: a swap period flashes raw glyph names ("settings",
       "home") as text before the font lands. */
    font-display: block;
    src: url("/${MATERIAL_SYMBOLS_FONT_PATH}") format("woff2");
}

.material-symbols-rounded {
    font-family: "Material Symbols Rounded";
    font-weight: normal;
    font-style: normal;
    font-size: 24px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    -webkit-font-feature-settings: "liga";
    -webkit-font-smoothing: antialiased;
}
`;
}

/** A browser UA — Google Fonts serves woff2 only to modern clients. */
export const MODERN_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { "User-Agent": MODERN_UA } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.text();
}

/**
 * Download the subset named by `names` and rewrite the vendored font, its
 * stylesheet, and the manifest. Network-bound: this is a maintenance script, not
 * anything the app runs.
 */
export async function vendorMaterialSymbols(
    names: string[] = usedIconNames(),
): Promise<SubsetManifest> {
    const url = subsetUrl(names);
    const css = await fetchText(url);
    const src = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!src) throw new Error(`No font URL in the Material Symbols CSS: ${url}`);

    const font = await fetch(src, { headers: { "User-Agent": MODERN_UA } });
    if (!font.ok) throw new Error(`GET ${src} → ${font.status}`);
    const bytes = new Uint8Array(await font.arrayBuffer());

    mkdirSync(dirname(MATERIAL_SYMBOLS_FONT), { recursive: true });
    writeFileSync(MATERIAL_SYMBOLS_FONT, bytes);
    writeFileSync(MATERIAL_SYMBOLS_CSS, materialSymbolsCss());

    const manifest: SubsetManifest = {
        names,
        source: url,
        bytes: bytes.byteLength,
    };
    writeFileSync(SUBSET_MANIFEST, `${JSON.stringify(manifest, null, 4)}\n`);
    return manifest;
}

if (import.meta.main) {
    const names = usedIconNames();

    if (process.argv.includes("--write")) {
        const manifest = await vendorMaterialSymbols(names);
        console.log(
            `Vendored ${manifest.names.length} icons (${manifest.bytes} bytes) → ${MATERIAL_SYMBOLS_FONT_PATH}`,
        );
    } else {
        const manifest = readSubsetManifest();
        const listed = new Set(manifest?.names ?? []);
        const missing = names.filter((name) => !listed.has(name));
        console.log(subsetUrl(names));
        console.error(
            `\n${names.length} icons used; ${listed.size} vendored; ${missing.length} missing.`,
        );
        if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
    }
}
