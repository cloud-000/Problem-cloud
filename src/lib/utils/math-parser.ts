export type ASTNode =
    | { type: "text"; content: string }
    | { type: "bold"; children: ASTNode[] }
    | { type: "italic"; children: ASTNode[] }
    | { type: "underline"; children: ASTNode[] }
    | { type: "strikethrough"; children: ASTNode[] }
    | { type: "url"; href: string; children: ASTNode[] }
    | { type: "code"; content: string }
    | { type: "asy"; imageSrc: string; code: string }
    | { type: "img"; src: string; label: string }
    | { type: "table"; head: TableRow[]; body: TableRow[] };

// A single cell of an allowlisted HTML table. `header` distinguishes <th> from
// <td>. `children` is the cell's inner content re-parsed through the inline
// parser, so BBCode and `$…$` math inside cells still work.
export interface TableCell {
    header: boolean;
    children: ASTNode[];
}

export interface TableRow {
    cells: TableCell[];
}

interface TagToken {
    type: "tag";
    name: string;
    isClose: boolean;
    attribute?: string;
    index: number;
    raw: string;
}

interface TextToken {
    type: "text";
    content: string;
    index: number;
}

type Token = TagToken | TextToken;

// Single source of truth for the supported tag set. `tokenize` builds a fresh
// global copy each call (stateful `lastIndex`).
const TAG_REGEX = /\[(\/?)(b|i|u|s|code|url|asy|img)(?:=([^\]]+))?\]/gi;

// --- Markdown images → Math-Images CDN ------------------------------------
//
// Statements author images with markdown syntax `![alt](path)` where `path` is
// a file in the cloud-000/Math-Images GitHub repo (e.g.
// `hmmt/2024_feb_guts/problem_36_image_1.png`). We serve them from jsDelivr's
// GitHub CDN. `@main` (not a pinned commit) is deliberate: the content-sync
// pipeline adds new images continuously, and a pinned SHA would 404 every image
// added after the app was last built. Change only this constant to re-pin.
const IMAGE_CDN_BASE = "https://cdn.jsdelivr.net/gh/cloud-000/Math-Images@main";

// `![alt](url)` — alt is optional; the url is a single non-space token.
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(\s*([^\s)]+)\s*\)/g;

// Resolve a markdown image target to a real URL. An already-absolute reference
// (has a scheme, or protocol-relative `//host`) is left untouched; anything
// else is treated as a repo-relative path into Math-Images.
function resolveImageSrc(target: string): string {
    const trimmed = target.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
        return trimmed;
    }
    return `${IMAGE_CDN_BASE}/${trimmed.replace(/^\/+/, "")}`;
}

// Split a run of plain text into text/img nodes, extracting markdown images and
// rewriting their target through `resolveImageSrc`. Text with no image is
// returned as a single text node.
function splitMarkdownImages(text: string): ASTNode[] {
    const regex = new RegExp(MARKDOWN_IMAGE_REGEX.source, "g");
    const nodes: ASTNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push({ type: "text", content: text.slice(lastIndex, match.index) });
        }
        nodes.push({
            type: "img",
            label: match[1],
            src: resolveImageSrc(match[2]),
        });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        nodes.push({ type: "text", content: text.slice(lastIndex) });
    }
    // Preserve the "empty run → nothing" invariant callers rely on.
    return nodes;
}

// Inline tags that wrap children and map directly to a node type.
function makeInlineNode(
    tagName: string,
    attribute: string | undefined,
    children: ASTNode[],
): ASTNode | null {
    switch (tagName) {
        case "b":
            return { type: "bold", children };
        case "i":
            return { type: "italic", children };
        case "u":
            return { type: "underline", children };
        case "s":
            return { type: "strikethrough", children };
        case "url":
            return { type: "url", href: attribute || "", children };
        default:
            return null;
    }
}

function tokenize(text: string): Token[] {
    const regex = new RegExp(TAG_REGEX.source, "gi");
    const tokens: Token[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const matchIndex = match.index;

        // Add text token before the match if there is any
        if (matchIndex > lastIndex) {
            tokens.push({
                type: "text",
                content: text.slice(lastIndex, matchIndex),
                index: lastIndex,
            });
        }

        tokens.push({
            type: "tag",
            name: match[2].toLowerCase(),
            isClose: match[1] === "/",
            attribute: match[3],
            index: matchIndex,
            raw: match[0],
        });

        lastIndex = regex.lastIndex;
    }

    // Add remaining text after the last match
    if (lastIndex < text.length) {
        tokens.push({
            type: "text",
            content: text.slice(lastIndex),
            index: lastIndex,
        });
    }

    return tokens;
}

/**
 * Parses BBCode text (no HTML tables) into an AST.
 * Verbatim tags (like [code] and [asy]) capture all tokens inside them as plain text.
 */
function parseBBCode(text: string): ASTNode[] {
    const tokens = tokenize(text);
    let index = 0;

    // Consume tokens verbatim until the matching close tag, returning the raw
    // inner text. Used by the verbatim tags [code] and [asy].
    function captureVerbatim(closeName: string): string {
        let content = "";
        while (index < tokens.length) {
            const current = tokens[index];
            if (
                current.type === "tag" &&
                current.name === closeName &&
                current.isClose
            ) {
                index++; // Consume close tag
                break;
            }
            content += current.type === "text" ? current.content : current.raw;
            index++;
        }
        return content;
    }

    // Parse tokens into nodes. When `endTagName` is set, stop and return at its
    // matching close tag (used while parsing the children of an inline tag).
    function parse(endTagName?: string): ASTNode[] {
        const nodes: ASTNode[] = [];

        while (index < tokens.length) {
            const token = tokens[index];

            if (token.type === "text") {
                nodes.push(...splitMarkdownImages(token.content));
                index++;
                continue;
            }

            if (token.isClose) {
                if (endTagName !== undefined && token.name === endTagName) {
                    index++; // Consume expected close tag and stop parsing children
                    return nodes;
                }
                // Unmatched closing tag, treat as plain text
                nodes.push({ type: "text", content: token.raw });
                index++;
                continue;
            }

            // Open tag
            const tagName = token.name;
            const attribute = token.attribute;
            index++; // Consume open tag

            if (tagName === "code") {
                nodes.push({ type: "code", content: captureVerbatim("code") });
            } else if (tagName === "asy") {
                nodes.push({
                    type: "asy",
                    imageSrc: attribute || "",
                    code: captureVerbatim("asy").trim(),
                });
            } else if (tagName === "img") {
                // [img]url[/img] (optional [img=label]url[/img]). The URL is the
                // verbatim body so it is never re-parsed for BBCode.
                nodes.push({
                    type: "img",
                    label: attribute || "",
                    src: captureVerbatim("img").trim(),
                });
            } else {
                const node = makeInlineNode(tagName, attribute, parse(tagName));
                if (node) nodes.push(node);
            }
        }

        return nodes;
    }

    return parse();
}

// --- HTML tables ----------------------------------------------------------
//
// Statements may embed a *small* allowlist of HTML table tags:
//   <table> <thead> <tbody> <tr> <td> <th>
// Everything else stays escaped exactly as before — this is NOT a general HTML
// hole. We never re-emit any tag or attribute from the input; the structure is
// rebuilt from scratch in `astToHtml` using a fixed template, and cell contents
// are re-parsed through the BBCode parser (so they are escaped/sanitized like
// any other inline text). Rows/cells found outside a <tr>/<td>/<th> are dropped.

// Given the offset just past a `<table…>` open tag, find the matching
// `</table>`, accounting for (unlikely) nested tables. Returns the inner markup
// and the index just past the close tag, or `end: -1` if unterminated.
function matchTable(
    text: string,
    from: number,
): { end: number; inner: string } {
    const re = /<(\/?)table\b[^>]*>/gi;
    re.lastIndex = from;
    let depth = 1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (match[1] === "/") {
            depth--;
            if (depth === 0) {
                return { end: re.lastIndex, inner: text.slice(from, match.index) };
            }
        } else {
            depth++;
        }
    }
    return { end: -1, inner: "" };
}

// Extract all `<tr>…</tr>` rows from a chunk of table markup, re-parsing each
// cell's inner content through the BBCode/inline parser. Any stray markup
// outside a <tr> or outside a <td>/<th> is ignored.
function parseRows(section: string): TableRow[] {
    const rows: TableRow[] = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(section)) !== null) {
        const cells: TableCell[] = [];
        const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)\s*>/gi;
        let cell: RegExpExecArray | null;
        while ((cell = cellRe.exec(tr[1])) !== null) {
            cells.push({
                header: cell[1].toLowerCase() === "th",
                children: parseBBCode(cell[2].trim()),
            });
        }
        rows.push({ cells });
    }
    return rows;
}

// Parse the inner markup of a <table> into head/body rows. <thead> rows go to
// `head`; every other <tr> (inside <tbody> or loose) goes to `body`. Returns
// null when there are no rows at all.
function parseTable(inner: string): ASTNode | null {
    const head: TableRow[] = [];
    const theadRe = /<thead\b[^>]*>([\s\S]*?)<\/thead\s*>/gi;
    let thead: RegExpExecArray | null;
    while ((thead = theadRe.exec(inner)) !== null) {
        head.push(...parseRows(thead[1]));
    }
    // Body = all rows outside <thead>. `parseRows` scans for <tr> regardless of
    // any <tbody> wrapper, so stripping the <thead> blocks is enough.
    const body = parseRows(inner.replace(theadRe, ""));

    if (head.length === 0 && body.length === 0) return null;
    return { type: "table", head, body };
}

// Split raw statement text into an AST, extracting allowlisted HTML tables at
// the top level and handing every non-table span to the BBCode parser.
function parseWithTables(text: string): ASTNode[] {
    const nodes: ASTNode[] = [];
    const openRe = /<table\b[^>]*>/i;
    let rest = text;

    while (true) {
        const open = openRe.exec(rest);
        if (!open) break;

        const { end, inner } = matchTable(rest, open.index + open[0].length);
        if (end === -1) break; // Unterminated <table>; fall through as text.

        if (open.index > 0) {
            nodes.push(...parseBBCode(rest.slice(0, open.index)));
        }
        const table = parseTable(inner);
        if (table) {
            nodes.push(table);
        } else {
            // Malformed/empty table: keep the raw span as (escaped) text.
            nodes.push(...parseBBCode(rest.slice(open.index, end)));
        }
        rest = rest.slice(end);
    }

    if (rest.length > 0) nodes.push(...parseBBCode(rest));
    return nodes;
}

// --- LaTeX tabular → array ------------------------------------------------
//
// KaTeX has no `tabular` environment, but its `array` environment accepts the
// same column spec (`l c r`, `|`, `\hline`), so we can render `tabular` by
// swapping the environment name. We only touch text *inside* math delimiters so
// a literal `\begin{tabular}` appearing as prose is left untouched.
const MATH_REGION_REGEX =
    /\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;

export function preprocessTabular(text: string): string {
    if (!text.includes("tabular")) return text;
    return text.replace(MATH_REGION_REGEX, (region) =>
        region
            .replace(/\\begin\{tabular\}/g, "\\begin{array}")
            .replace(/\\end\{tabular\}/g, "\\end{array}"),
    );
}

/**
 * Parses a statement into an AST: swaps LaTeX `tabular`→`array` inside math,
 * extracts allowlisted HTML tables, and parses everything else as BBCode.
 */
export function parseMathStatement(text: string): ASTNode[] {
    return parseWithTables(preprocessTabular(text));
}

// --- HTML rendering -------------------------------------------------------
//
// The AST is rendered to a single HTML string that is injected via Svelte's
// {@html}. Math delimiters ($...$ etc.) are left untouched so KaTeX can render
// them afterwards; [code] and [asy] are marked `katex-ignore` so KaTeX skips
// them. Because this feeds {@html}, all literal text and URLs are escaped.

const URL_CLASS = "text-primary-foreground hover:underline transition-all";
const CODE_CLASS =
    "katex-ignore px-1.5 py-0.5 rounded bg-surface-container-low text-foreground font-mono text-xs border border-border";
const IMG_CLASS =
    "katex-ignore block max-w-full max-h-[300px] object-contain mx-auto my-3 rounded-lg";
const ASY_IMG_CLASS = IMG_CLASS;
const ASY_PRE_CLASS =
    "katex-ignore block font-mono text-sm leading-relaxed p-4 my-3 rounded-lg bg-surface-container-low/50 border border-border/60 overflow-x-auto text-foreground max-h-[250px]";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Reject URLs with a scheme outside the allowlist (blocks javascript:, etc.).
function sanitizeUrl(url: string, allowed: string[], fallback: string): string {
    const trimmed = url.trim();
    const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !allowed.includes(scheme[1].toLowerCase())) {
        return fallback;
    }
    return trimmed;
}

// Plain-text content of an inline run, used as the [url] fallback href.
function astText(nodes: ASTNode[]): string {
    let text = "";
    for (const node of nodes) {
        if (node.type === "text" || node.type === "code") {
            text += node.content;
        } else if (node.type === "table") {
            for (const row of [...node.head, ...node.body]) {
                for (const cell of row.cells) text += astText(cell.children);
            }
        } else if (node.type !== "asy" && node.type !== "img") {
            // Remaining childless nodes (asy, img) carry no inline text.
            text += astText(node.children);
        }
    }
    return text;
}

/**
 * Renders a parsed statement to an HTML string suitable for {@html}.
 * Math delimiters are preserved for KaTeX; text and URLs are escaped.
 */
export function astToHtml(nodes: ASTNode[]): string {
    let html = "";

    for (const node of nodes) {
        switch (node.type) {
            case "text":
                html += escapeHtml(node.content);
                break;
            case "bold":
                html += `<strong>${astToHtml(node.children)}</strong>`;
                break;
            case "italic":
                html += `<em>${astToHtml(node.children)}</em>`;
                break;
            case "underline":
                html += `<u>${astToHtml(node.children)}</u>`;
                break;
            case "strikethrough":
                html += `<s>${astToHtml(node.children)}</s>`;
                break;
            case "url": {
                const href = sanitizeUrl(
                    node.href || astText(node.children),
                    ["http", "https", "mailto"],
                    "#",
                );
                html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="${URL_CLASS}">${astToHtml(node.children)}</a>`;
                break;
            }
            case "code":
                html += `<code class="${CODE_CLASS}">${escapeHtml(node.content)}</code>`;
                break;
            case "img": {
                const src = sanitizeUrl(
                    node.src,
                    ["http", "https", "data"],
                    "",
                );
                if (src) {
                    const alt = escapeHtml(node.label || "Image");
                    html += `<img src="${escapeHtml(src)}" alt="${alt}" class="${IMG_CLASS}" />`;
                }
                break;
            }
            case "asy": {
                const src = node.imageSrc
                    ? sanitizeUrl(node.imageSrc, ["http", "https", "data"], "")
                    : "";
                if (src) {
                    html += `<img src="${escapeHtml(src)}" alt="Asymptote diagram" class="${ASY_IMG_CLASS}" />`;
                } else {
                    html += `<pre class="${ASY_PRE_CLASS}"><code>${escapeHtml(node.code)}</code></pre>`;
                }
                break;
            }
            case "table":
                html += tableToHtml(node);
                break;
        }
    }

    return html;
}

// Rebuild an allowlisted table as sanitized markup. Only the fixed tag set and
// a fixed class are emitted — no attribute from the source is ever reproduced —
// and cell contents run back through `astToHtml`, so they are escaped like any
// other inline text. The table is wrapped so wide tables scroll horizontally.
function tableToHtml(node: Extract<ASTNode, { type: "table" }>): string {
    const renderRow = (row: TableRow): string => {
        const cells = row.cells
            .map((cell) => {
                const tag = cell.header ? "th" : "td";
                return `<${tag}>${astToHtml(cell.children)}</${tag}>`;
            })
            .join("");
        return `<tr>${cells}</tr>`;
    };

    let out = '<div class="overflow-x-auto"><table class="pc-table">';
    if (node.head.length > 0) {
        out += `<thead>${node.head.map(renderRow).join("")}</thead>`;
    }
    if (node.body.length > 0) {
        out += `<tbody>${node.body.map(renderRow).join("")}</tbody>`;
    }
    out += "</table></div>";
    return out;
}

// --- Segmentation ---------------------------------------------------------
//
// An asy diagram or plain image is rendered as a real interactive Svelte
// component (toggle code/image, expand, invert), which cannot live inside the
// KaTeX clone in LaTeX.svelte. So the top-level statement is split into an
// ordered list of segments: runs of inline markup become a single `html`
// segment (rendered via one <LaTeX>), and each image-bearing asy/img node
// becomes its own `asy`/`img` segment (rendered as <Figure>) between them.

export type StatementSegment =
    | { kind: "html"; html: string }
    | { kind: "asy"; imageSrc: string; code: string }
    | { kind: "img"; src: string; alt: string };

export function segmentStatement(nodes: ASTNode[]): StatementSegment[] {
    const segments: StatementSegment[] = [];
    let buffer: ASTNode[] = [];

    function flush() {
        if (buffer.length > 0) {
            segments.push({ kind: "html", html: astToHtml(buffer) });
            buffer = [];
        }
    }

    for (const node of nodes) {
        // Only asy nodes with a valid image become interactive components.
        // A code-only asy stays in the buffer so astToHtml renders it as the
        // static <pre> fallback (interactivity is meaningless without an image).
        if (node.type === "asy") {
            const src = sanitizeUrl(
                node.imageSrc,
                ["http", "https", "data"],
                "",
            );
            if (src) {
                flush();
                segments.push({ kind: "asy", imageSrc: src, code: node.code });
                continue;
            }
        }

        // Plain images become their own interactive segment too, so they get
        // the same toolbar/invert/lightbox treatment as asy diagrams. Image
        // nodes are always top-level (from markdown text runs or the [img]
        // tag), so pulling them out of the buffer here is complete.
        if (node.type === "img") {
            const src = sanitizeUrl(node.src, ["http", "https", "data"], "");
            if (src) {
                flush();
                segments.push({ kind: "img", src, alt: node.label || "Image" });
                continue;
            }
        }
        buffer.push(node);
    }

    flush();
    return segments;
}
