/**
 * Generate same-origin Material Symbols Rounded SVGs, one file per icon.
 * Both fill states are included; explicit numeric axes on <Icon> add instances.
 * The conservative name scan includes dynamic data objects but excludes comments
 * and tests. Unused names cost offline storage, not a global foreground font.
 * Run `bun scripts/icon-subset.ts --write` after adding icons or axis instances.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse } from "svelte/compiler";
import { DEFAULT_ICON_AXES, iconVariantId, type IconAxes } from "../src/lib/components/icon/assets";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_HTML = join(root, "src/app.html");
export const NAMES_FILE = join(root, "scripts/material-symbols-names.txt");
// Build metadata stays outside static/ so it is neither deployed nor precached.
export const SUBSET_MANIFEST = join(root, ".cache/render-assets/material-symbols-subset.json");
export const ICON_DIRECTORY = join(root, "static/vendor/material-symbols");
// Pin the upstream artwork so clean installs reproduce the same SVGs.
export const ICON_REVISION = "49d4db35df873165d6bd6ba09b063c7dafbac2f4";
export const ICON_SOURCE = `https://raw.githubusercontent.com/google/material-design-icons/${ICON_REVISION}`;

export function knownIconNames(): Set<string> {
    return new Set(readFileSync(NAMES_FILE, "utf8").split(/\s+/).filter(Boolean));
}
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        if (name.startsWith(".") || name === "node_modules") return [];
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(svelte|ts|js)$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
    });
}
// The Svelte AST contains ordinary ESTree nodes as well as template nodes.
function visit(node: unknown, callback: (node: any) => void): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item, callback); return; }
    callback(node);
    for (const [key, value] of Object.entries(node)) {
        if (key !== "parent" && key !== "metadata") visit(value, callback);
    }
}
export function iconRequirements(): Map<string, IconAxes[]> {
    const known = knownIconNames();
    const found = new Map<string, IconAxes[]>();
    const add = (name: string, axes?: IconAxes) => {
        if (!known.has(name)) return;
        let variants = found.get(name);
        if (!variants) {
            variants = [DEFAULT_ICON_AXES, { ...DEFAULT_ICON_AXES, fill: true }];
            found.set(name, variants);
        }
        if (axes && !variants.some((v) => iconVariantId(v) === iconVariantId(axes))) variants.push(axes);
    };
    for (const file of sourceFiles(join(root, "src"))) {
        const source = readFileSync(file, "utf8");
        if (!file.endsWith(".svelte")) {
            const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const collect = (node: ts.Node) => {
                if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
                ts.forEachChild(node, collect);
            };
            collect(ast);
            continue;
        }
        const ast = parse(source, { modern: true });
        visit(ast, (node) => {
            if (node.type === "Literal" && typeof node.value === "string") add(node.value);
            if (node.type === "Text") add(node.data.trim());
            if (node.type !== "Component" || node.name !== "Icon") return;
            if (node.fragment.nodes.some((n: any) => n.type !== "Text" || n.data.trim())) {
                throw new Error(`${file}: SVG icons require a name prop instead of text children`);
            }
            const attrs = node.attributes.filter((a: any) => a.type === "Attribute");
            const attr = (name: string) => attrs.find((a: any) => a.name === name);
            const value = (a: any) => a?.value?.expression?.value ?? a?.value?.[0]?.expression?.value ?? a?.value?.[0]?.data;
            const axes = { ...DEFAULT_ICON_AXES };
            let custom = false;
            for (const key of ["weight", "grade", "opticalSize"] as const) {
                if (!attr(key)) continue;
                const number = Number(value(attr(key)));
                if (!Number.isFinite(number)) throw new Error(`${file}: SVG icon ${key} must be a static number`);
                axes[key] = number;
                custom = true;
            }
            if (!custom) return;
            const name = value(attr("name"));
            if (typeof name !== "string" || !known.has(name)) {
                throw new Error(`${file}: custom SVG axes require a static icon name`);
            }
            // Include both states: fill may be driven by selected/active state.
            add(name, axes);
            add(name, { ...axes, fill: true });
        });
    }
    return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}
export function usedIconNames(): string[] { return [...iconRequirements().keys()]; }

export type IconFile = { name: string; bytes: number; sha256: string; variants: string[] };
export type SubsetManifest = { source: string; names: string[]; bytes: number; files: IconFile[] };
export function readSubsetManifest(): SubsetManifest | null {
    if (!existsSync(SUBSET_MANIFEST)) return null;
    return JSON.parse(readFileSync(SUBSET_MANIFEST, "utf8"));
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function missingIconAssets(): string[] {
    const manifest = readSubsetManifest();
    if (!manifest?.files || manifest.source !== ICON_SOURCE) return ["generated SVG icons (run bun scripts/icon-subset.ts --write)"];
    const missing: string[] = [];
    if (!existsSync(join(ICON_DIRECTORY, "LICENSE"))) missing.push("Material Symbols license");
    for (const [name, axes] of iconRequirements()) {
        const entry = manifest.files.find((f) => f.name === name);
        const path = join(ICON_DIRECTORY, `${name}.svg`);
        if (!entry || !existsSync(path) || hash(readFileSync(path)) !== entry.sha256 ||
            axes.some((v) => !entry.variants.includes(iconVariantId(v)))) missing.push(`SVG icon: ${name}`);
    }
    return missing;
}
export function upstreamIconUrl(name: string, axes: IconAxes): string {
    const weight = axes.weight === 400 ? "" : `_wght${axes.weight}`;
    const grade = axes.grade === 0 ? "" : `_grad${axes.grade < 0 ? `N${-axes.grade}` : axes.grade}`;
    const fill = axes.fill ? "fill1" : "";
    const suffix = weight + (weight ? grade.replace("_", "") : grade) + (fill ? `${weight || grade ? "" : "_"}${fill}` : "");
    return `${ICON_SOURCE}/symbols/web/${name}/materialsymbolsrounded/${name}${suffix}_${axes.opticalSize}px.svg`;
}
export function svgSymbol(source: string, id: string): string {
    const viewBox = source.match(/viewBox="([^"]+)"/)?.[1] ??
        `0 0 ${source.match(/width="(\d+)"/)?.[1]} ${source.match(/height="(\d+)"/)?.[1]}`;
    const paths = [...source.matchAll(/<path\s+d="([^"]+)"\s*\/>/g)].map((m) => m[1]);
    // Only trusted, pinned upstream path data is emitted, never arbitrary SVG markup.
    if (!viewBox || !/^[\d .-]+$/.test(viewBox) || !paths.length ||
        paths.some((p) => !/^[a-zA-Z\d .,\-+]+$/.test(p))) throw new Error(`Unexpected upstream SVG: ${id}`);
    return `<symbol id="${id}" viewBox="${viewBox}">${paths.map((d) => `<path d="${d}"/>`).join("")}</symbol>`;
}
export async function vendorMaterialSymbols(): Promise<SubsetManifest> {
    const requirements = [...iconRequirements()];
    // Font ligatures include aliases (create/edit/mode_edit) that share one
    // codepoint. The SVG repository keeps only the canonical artwork name.
    const codepoints = await fetch(`${ICON_SOURCE}/variablefont/MaterialSymbolsRounded%5BFILL,GRAD,opsz,wght%5D.codepoints`);
    if (!codepoints.ok) throw new Error(`Material Symbols codepoints: ${codepoints.status}`);
    const pairs = (await codepoints.text()).trim().split("\n").map((line) => line.split(/\s+/));
    const pointFor = new Map(pairs.map(([name, point]) => [name, point]));
    const aliases = new Map<string, string[]>();
    for (const [name, point] of pairs) aliases.set(point, [...(aliases.get(point) ?? []), name]);
    mkdirSync(ICON_DIRECTORY, { recursive: true });
    const previous = readSubsetManifest();
    const files: IconFile[] = [];
    // Bound concurrency rather than making hundreds of simultaneous requests.
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < requirements.length) {
            const [name, axes] = requirements[next++];
            const path = join(ICON_DIRECTORY, `${name}.svg`);
            const ids = axes.map(iconVariantId);
            const cached = previous?.source === ICON_SOURCE ? previous.files?.find((f) => f.name === name) : undefined;
            if (cached && ids.join() === cached.variants.join() && existsSync(path) && hash(readFileSync(path)) === cached.sha256) {
                files.push(cached);
                continue;
            }
            const symbols: string[] = [];
            for (const variant of axes) {
                const candidates = [name, ...(aliases.get(pointFor.get(name) ?? "") ?? []).filter((alias) => alias !== name)];
                let symbol: string | undefined;
                for (const candidate of candidates) {
                    const url = upstreamIconUrl(candidate, variant);
                    const response = await fetch(url);
                    if (response.status === 404) continue;
                    if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
                    try { symbol = svgSymbol(await response.text(), iconVariantId(variant)); }
                    catch (error) { throw new Error(`${url}: ${error}`); }
                    break;
                }
                if (!symbol) throw new Error(`No upstream SVG for ${name}, ${iconVariantId(variant)}`);
                symbols.push(symbol);
            }
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>\n`;
            writeFileSync(path, svg);
            files.push({ name, bytes: Buffer.byteLength(svg), sha256: hash(svg), variants: ids });
        }
    }));
    files.sort((a, b) => a.name.localeCompare(b.name));
    const names = files.map((f) => f.name);
    for (const file of readdirSync(ICON_DIRECTORY)) {
        if (file.endsWith(".svg") && !names.includes(file.slice(0, -4))) rmSync(join(ICON_DIRECTORY, file));
    }
    const license = await fetch(`${ICON_SOURCE}/LICENSE`);
    if (!license.ok) throw new Error(`Material Symbols license download failed: ${license.status}`);
    writeFileSync(join(ICON_DIRECTORY, "LICENSE"), await license.text());
    const manifest = { source: ICON_SOURCE, names, files, bytes: files.reduce((n, f) => n + f.bytes, 0) };
    mkdirSync(dirname(SUBSET_MANIFEST), { recursive: true });
    writeFileSync(SUBSET_MANIFEST, JSON.stringify(manifest, null, 4) + "\n");
    return manifest;
}
if (import.meta.main) {
    if (process.argv.includes("--write")) {
        const manifest = await vendorMaterialSymbols();
        console.log(`Vendored ${manifest.names.length} SVG icons (${manifest.bytes} bytes)`);
    } else console.log(missingIconAssets());
}
