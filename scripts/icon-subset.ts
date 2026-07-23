/**
 * Material Symbols subsetting.
 *
 * `app.html` loads Material Symbols Rounded from Google Fonts. Requested without
 * an `icon_names` filter, that URL serves the *whole* variable font — all ~4200
 * glyphs across four axes, 5.1 MB — on every cold load. Naming the icons we
 * actually use cuts it to ~290 KB.
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
 * `bun scripts/icon-subset.ts` prints the current URL; `--write` updates
 * `app.html` in place. `icon-subset.test.ts` fails if the two drift apart.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const NAMES_FILE = join(here, "material-symbols-names.txt");
export const APP_HTML = join(root, "src", "app.html");

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

/**
 * The Material Symbols href currently in `app.html`, or null.
 *
 * Returns the decoded URL: the attribute writes `&` as `&amp;`, since
 * `&icon_names=` is an "ambiguous ampersand" that HTML5 flags as a parse error
 * bare (browsers cope, validators don't).
 */
const HREF_RE =
    /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Rounded[^"]*/;

export function currentUrl(html = readFileSync(APP_HTML, "utf8")): string | null {
    const m = html.match(HREF_RE);
    return m ? m[0].replaceAll("&amp;", "&") : null;
}

if (import.meta.main) {
    const names = usedIconNames();
    const url = subsetUrl(names);

    if (process.argv.includes("--write")) {
        const html = readFileSync(APP_HTML, "utf8");
        if (!HREF_RE.test(html))
            throw new Error(`No Material Symbols <link> found in ${APP_HTML}`);
        writeFileSync(APP_HTML, html.replace(HREF_RE, url.replaceAll("&", "&amp;")));
        console.log(`Updated app.html with ${names.length} icons.`);
    } else {
        console.log(url);
        console.error(`\n${names.length} icons.`);
    }
}
