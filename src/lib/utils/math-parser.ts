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
    | { type: "table"; head: TableRow[]; body: TableRow[] }
    | { type: "center"; children: ASTNode[] }
    // Block nodes. Markdown produces most of these, while `linebreak` and
    // `center` can also come from the small HTML allowlist used by statements.
    // BBCode statements otherwise remain a single implicit paragraph.
    | { type: "paragraph"; children: ASTNode[] }
    | { type: "heading"; level: number; children: ASTNode[] }
    | { type: "list"; ordered: boolean; items: ASTNode[][] }
    | { type: "blockquote"; children: ASTNode[] }
    | { type: "codeblock"; content: string }
    | { type: "linebreak" }
    | { type: "rule" };

// A single cell of an allowlisted HTML table. `header` distinguishes <th> from
// <td>. `children` is the cell's inner content re-parsed through the inline
// parser, so BBCode and `$\dots$` math inside cells still work.
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
export function resolveImageSrc(target: string): string {
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
            nodes.push({
                type: "text",
                content: text.slice(lastIndex, match.index),
            });
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

// --- Allowlisted HTML fragments -------------------------------------------
//
// Statements may embed a *small* allowlist of HTML fragments used by the
// source scraper: tables, explicit line breaks, lists, and centered content.
// Everything else stays escaped exactly as before — this is NOT a general HTML
// hole. We never re-emit any tag or attribute from the input; the structure is
// rebuilt from scratch in `astToHtml`, and nested content is parsed again so it
// is escaped/sanitized like any other statement text.

// This is intentionally an open-tag matcher rather than an HTML parser. The
// input is authored contest content, and the output is rebuilt from fixed
// templates below; attributes are only consumed so they can never reach HTML.
const HTML_FRAGMENT_REGEX =
    /<table\b[^>]*>|<center\b[^>]*>|<br\b[^>]*\/?>|<(?:ul|ol)\b[^>]*>/i;

// HTML-looking text inside a BBCode verbatim block belongs to the code/asy
// payload, not to the statement markup. The normal BBCode parser already
// owns this rule; repeat the small amount of state here so the HTML scanner
// does not split a verbatim node before that parser gets to see it.
function isInsideVerbatim(text: string, position: number): boolean {
    const re = new RegExp(TAG_REGEX.source, "gi");
    let active: "code" | "asy" | null = null;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null && match.index < position) {
        const name = match[2].toLowerCase();
        if (name !== "code" && name !== "asy") continue;

        if (match[1] === "/") {
            if (active === name) active = null;
        } else if (active === null) {
            active = name;
        }
    }

    return active !== null;
}

function nextHtmlFragment(text: string): RegExpExecArray | null {
    const re = new RegExp(HTML_FRAGMENT_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (!isInsideVerbatim(text, match.index)) return match;
    }
    return null;
}

// Find the matching `</center>`, accounting for nested centers. Returns the
// inner markup and the index just past the close tag, or `end: -1` when the
// fragment is unterminated.
function matchCenter(
    text: string,
    from: number,
): { end: number; inner: string } {
    const re = /<(\/?)center\b[^>]*>/gi;
    re.lastIndex = from;
    let depth = 1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (match[1] === "/") {
            depth--;
            if (depth === 0) {
                return {
                    end: re.lastIndex,
                    inner: text.slice(from, match.index),
                };
            }
        } else {
            depth++;
        }
    }
    return { end: -1, inner: "" };
}

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
                return {
                    end: re.lastIndex,
                    inner: text.slice(from, match.index),
                };
            }
        } else {
            depth++;
        }
    }
    return { end: -1, inner: "" };
}

function matchHtmlList(
    text: string,
    startIndex: number,
    tag: "ul" | "ol",
): { end: number; inner: string } {
    const openTag = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    const closeTag = new RegExp(`</${tag}\\s*>`, "gi");
    openTag.lastIndex = startIndex;
    closeTag.lastIndex = startIndex;

    let depth = 1;
    let pos = startIndex;

    while (depth > 0 && pos < text.length) {
        openTag.lastIndex = pos;
        closeTag.lastIndex = pos;

        const nextOpen = openTag.exec(text);
        const nextClose = closeTag.exec(text);

        if (!nextClose) return { end: -1, inner: "" };

        if (nextOpen && nextOpen.index < nextClose.index) {
            depth++;
            pos = nextOpen.index + nextOpen[0].length;
        } else {
            depth--;
            if (depth === 0) {
                return {
                    end: nextClose.index + nextClose[0].length,
                    inner: text.slice(startIndex, nextClose.index),
                };
            }
            pos = nextClose.index + nextClose[0].length;
        }
    }
    return { end: -1, inner: "" };
}

function parseHtmlListItems(innerHtml: string): ASTNode[][] {
    const items: ASTNode[][] = [];
    const liRegex = /<li\b[^>]*>([\s\S]*?)(?:<\/li\s*>|(?=<li\b)|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = liRegex.exec(innerHtml)) !== null) {
        const itemContent = match[1].trim();
        if (itemContent) {
            items.push(parseBlocksAndBBCode(itemContent));
        }
    }
    return items;
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
                children: parseWithHtml(cell[2].trim()),
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

// --- List and Block detection in authored statements ----------------------
//
// Math statements (and forum/wiki scraped content) frequently include lists
// formatted as standard Markdown bullets (`* `, `- `, `+ `), Unicode bullets
// (`• `), ordered lists (`1. `, `1) `, `(1) `), or bare MediaWiki bullets (`*Item`).
// We disambiguate bare `*` from italic labels (`*Note:*`), full-line italics
// (`*Party of Five*`), dividers (`***`), and markdown bold (`**`).
export interface ListItemMatch {
    ordered: boolean;
    content: string;
}

export function matchListItem(line: string): ListItemMatch | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Ordered list: 1. item, 1) item, (1) item
    const orderedMatch = /^(?:\d{1,9}[.)]|\(\d{1,9}\))\s+(.*)$/.exec(trimmed);
    if (orderedMatch) {
        return { ordered: true, content: orderedMatch[1] };
    }

    // Standard markdown bullet: - item, + item, * item
    const standardBullet = /^[-+*]\s+(.*)$/.exec(trimmed);
    if (standardBullet) {
        return { ordered: false, content: standardBullet[1] };
    }

    // Unicode bullet: • item or •item
    const unicodeBullet = /^•\s*(.*)$/.exec(trimmed);
    if (unicodeBullet) {
        return { ordered: false, content: unicodeBullet[1] };
    }

    // MediaWiki bullet starting with "*" without space:
    if (trimmed.startsWith("*")) {
        // Exclude dividers: ***
        if (/^\*{3,}\s*$/.test(trimmed)) return null;
        // Exclude markdown bold: **...**
        if (trimmed.startsWith("**")) return null;
        // Exclude full-line italics: *italic text*
        if (/^\*[^\s*](?:.*[^\s*])?\*$/.test(trimmed)) return null;
        // Exclude italic labels/prefixes: *Note:* or *Remark.* or *H1.*
        if (/^\*[A-Za-z0-9_ -]+[:.]?\*\s+/.test(trimmed)) return null;
        // Code closing comment: */
        if (trimmed === "*/") return null;

        const content = trimmed.slice(1).trimStart();
        if (content.length > 0) {
            return { ordered: false, content };
        }
    }

    return null;
}

/**
 * Parses a span of statement text, extracting block lists (ordered and unordered)
 * while handing non-list text to `parseBBCode`. Verbatim tags like `[code]` and
 * `[asy]`, as well as multiline math blocks, are protected so markers inside
 * diagrams/code/math are never split.
 */
function parseBlocksAndBBCode(text: string): ASTNode[] {
    if (!text.includes("\n")) {
        return parseBBCode(text);
    }

    const lines = text.split("\n");
    const nodes: ASTNode[] = [];
    let proseLines: string[] = [];

    const flushProse = () => {
        if (proseLines.length === 0) return;
        const chunk = proseLines.join("\n");
        proseLines = [];
        nodes.push(...parseBBCode(chunk));
    };

    let inVerbatim: "code" | "asy" | null = null;
    let inMathEnv: string | null = null;
    let inDisplayMath: "$$" | "\\[" | null = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const lower = line.toLowerCase();

        if (inVerbatim) {
            proseLines.push(line);
            if (lower.includes(`[/${inVerbatim}]`)) inVerbatim = null;
            i++;
            continue;
        }

        if (inMathEnv) {
            proseLines.push(line);
            if (line.includes(`\\end{${inMathEnv}}`)) inMathEnv = null;
            i++;
            continue;
        }

        if (inDisplayMath) {
            proseLines.push(line);
            if (line.includes(inDisplayMath === "$$" ? "$$" : "\\]")) inDisplayMath = null;
            i++;
            continue;
        }

        if (lower.includes("[code]")) {
            inVerbatim = "code";
            proseLines.push(line);
            if (lower.includes("[/code]")) inVerbatim = null;
            i++;
            continue;
        }

        if (lower.includes("[asy")) {
            inVerbatim = "asy";
            proseLines.push(line);
            if (lower.includes("[/asy]")) inVerbatim = null;
            i++;
            continue;
        }

        const envMatch = line.match(/\\begin\{(align\*?|alignat\*?|gather\*?|equation\*?|multline\*?|CD)\}/);
        if (envMatch) {
            const env = envMatch[1];
            proseLines.push(line);
            if (!line.includes(`\\end{${env}}`)) {
                inMathEnv = env;
            }
            i++;
            continue;
        }

        if (line.includes("$$")) {
            const count = (line.match(/\$\$/g) || []).length;
            if (count % 2 === 1) {
                inDisplayMath = "$$";
                proseLines.push(line);
                i++;
                continue;
            }
        }

        if (line.includes("\\[") && !line.includes("\\]")) {
            inDisplayMath = "\\[";
            proseLines.push(line);
            i++;
            continue;
        }

        const match = matchListItem(line);
        if (match) {
            flushProse();
            const isOrdered = match.ordered;
            const items: ASTNode[][] = [];
            let currentItemLines: string[] = [match.content];

            const flushItem = () => {
                if (currentItemLines.length === 0) return;
                const itemText = currentItemLines.join("\n").trim();
                currentItemLines = [];
                if (itemText) {
                    items.push(parseBlocksAndBBCode(itemText));
                }
            };

            i++;
            while (i < lines.length) {
                const nextLine = lines[i];
                const nextTrimmed = nextLine.trim();

                // Blank line handling: continues list if another item of same type follows
                if (!nextTrimmed) {
                    let lookahead = i + 1;
                    while (lookahead < lines.length && !lines[lookahead].trim()) {
                        lookahead++;
                    }
                    if (lookahead < lines.length) {
                        const lookaheadMatch = matchListItem(lines[lookahead]);
                        if (lookaheadMatch && lookaheadMatch.ordered === isOrdered) {
                            i = lookahead;
                            flushItem();
                            currentItemLines.push(lookaheadMatch.content);
                            i++;
                            continue;
                        }
                    }
                    break;
                }

                const nextMatch = matchListItem(nextLine);
                if (nextMatch && nextMatch.ordered === isOrdered) {
                    flushItem();
                    currentItemLines.push(nextMatch.content);
                    i++;
                    continue;
                }

                if (nextMatch) break;

                // Indented line is a continuation line of the current item
                if (/^\s{2,}/.test(nextLine)) {
                    currentItemLines.push(nextLine.trim());
                    i++;
                    continue;
                }

                break;
            }

            flushItem();
            if (items.length > 0) {
                nodes.push({ type: "list", ordered: isOrdered, items });
            }
            continue;
        }

        proseLines.push(line);
        i++;
    }

    flushProse();
    return nodes;
}

// Split raw statement text into an AST, extracting allowlisted HTML fragments
// at the top level and handing every other span to the block/BBCode parser.
function parseWithHtml(text: string): ASTNode[] {
    const nodes: ASTNode[] = [];
    let rest = text;

    while (true) {
        const open = nextHtmlFragment(rest);
        if (!open) break;

        if (open.index > 0) {
            nodes.push(...parseBlocksAndBBCode(rest.slice(0, open.index)));
        }

        const raw = open[0];
        if (/^<br\b/i.test(raw)) {
            nodes.push({ type: "linebreak" });
            rest = rest.slice(open.index + raw.length);
            continue;
        }

        const listMatch = /^<(ul|ol)\b/i.exec(raw);
        if (listMatch) {
            const tag = listMatch[1].toLowerCase() as "ul" | "ol";
            const { end, inner } = matchHtmlList(rest, open.index + raw.length, tag);
            if (end === -1) {
                nodes.push(...parseBlocksAndBBCode(rest.slice(open.index)));
                return nodes;
            }
            const items = parseHtmlListItems(inner);
            if (items.length > 0) {
                nodes.push({ type: "list", ordered: tag === "ol", items });
            }
            rest = rest.slice(end);
            continue;
        }

        if (/^<center\b/i.test(raw)) {
            const { end, inner } = matchCenter(
                rest,
                open.index + raw.length,
            );
            if (end === -1) {
                nodes.push(...parseBlocksAndBBCode(rest.slice(open.index)));
                return nodes;
            }
            nodes.push({ type: "center", children: parseWithHtml(inner) });
            rest = rest.slice(end);
            continue;
        }

        const { end, inner } = matchTable(rest, open.index + raw.length);
        if (end === -1) {
            nodes.push(...parseBlocksAndBBCode(rest.slice(open.index)));
            return nodes;
        }

        const table = parseTable(inner);
        if (table) {
            nodes.push(table);
        } else {
            nodes.push(...parseBlocksAndBBCode(rest.slice(open.index, end)));
        }
        rest = rest.slice(end);
    }

    if (rest.length > 0) nodes.push(...parseBlocksAndBBCode(rest));
    return nodes;
}

// --- LaTeX tabular → array ------------------------------------------------
//
// KaTeX has no `tabular` environment, but its `array` environment accepts the
// same column spec (`l c r`, `|`, `\hline`), so we can render `tabular` by
// swapping the environment name. We only touch text *inside* math delimiters so
// a literal `\begin{tabular}` appearing as prose is left untouched.
export const MATH_REGION_REGEX =
    /\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\[[\s\S]*?\\]|\\begin\{(align\*?|alignat\*?|gather\*?|equation\*?|multline\*?|CD)\}[\s\S]*?\\end\{\1\}/g;

export function preprocessTabular(text: string): string {
    if (!text.includes("tabular")) return text;
    return text.replace(MATH_REGION_REGEX, (region) =>
        region
            .replace(/\\begin\{tabular\}/g, "\\begin{array}")
            .replace(/\\end\{tabular\}/g, "\\end{array}"),
    );
}

/**
 * Normalizes MediaWiki bold (`'''bold'''`), MediaWiki italic (`''italic''`),
 * markdown bold (`**bold**`), and HTML formatting elements (`<b>`, `<i>`, etc.)
 * to standard BBCode `[b]` and `[i]`.
 * Math regions and verbatim blocks (`[code]`, `[asy]`) are masked so prime
 * derivatives like `$f''(x)$`, symbols, and math comparisons like `$x < y$` are preserved.
 */
export function preprocessFormatting(text: string): string {
    // Unwrap display environments wrapped in single '$' so KaTeX auto-render
    // processes them in display mode rather than failing with inline-mode error.
    text = text.replace(
        /(?<!\$)\$(\s*\\begin\{(?:align\*?|alignat\*?|gather\*?|multline\*?)\}[\s\S]*?\\end\{(?:align\*?|alignat\*?|gather\*?|multline\*?)\}\s*)\$(?!\$)/g,
        "$1",
    );

    if (!text.includes("''") && !text.includes("**") && !text.includes("<")) return text;

    const mathMasked: string[] = [];
    let masked = text.replace(MATH_REGION_REGEX, (m) => {
        const idx = mathMasked.length;
        mathMasked.push(m);
        return `@@MATH_${idx}@@`;
    });

    const verbatimMasked: string[] = [];
    masked = masked.replace(/\[(code|asy)\b[^\]]*\][\s\S]*?\[\/\1\]/gi, (m) => {
        const idx = verbatimMasked.length;
        verbatimMasked.push(m);
        return `@@VERBATIM_${idx}@@`;
    });

    // MediaWiki bold '''text''' -> [b]text[/b]
    masked = masked.replace(/'''([^\n']+?)'''/g, "[b]$1[/b]");
    // MediaWiki italic ''text'' -> [i]text[/i]
    masked = masked.replace(/''([^\n']+?)''/g, "[i]$1[/i]");
    // Markdown bold **text** -> [b]text[/b]
    masked = masked.replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, "[b]$1[/b]");

    // HTML inline tags: <b>, <strong>, <i>, <em>, <u>, <s>, <strike>, <del>, <p>
    masked = masked.replace(/<\/?(?:b|strong)\b[^>]*>/gi, (m) =>
        m.startsWith("</") ? "[/b]" : "[b]",
    );
    masked = masked.replace(/<\/?(?:i|em)\b[^>]*>/gi, (m) =>
        m.startsWith("</") ? "[/i]" : "[i]",
    );
    masked = masked.replace(/<\/?u\b[^>]*>/gi, (m) =>
        m.startsWith("</") ? "[/u]" : "[u]",
    );
    masked = masked.replace(/<\/?(?:s|strike|del)\b[^>]*>/gi, (m) =>
        m.startsWith("</") ? "[/s]" : "[s]",
    );
    masked = masked.replace(/<\/?p\b[^>]*>/gi, "\n\n");

    masked = masked.replace(/@@VERBATIM_(\d+)@@/g, (_, idx) => verbatimMasked[+idx]);
    masked = masked.replace(/@@MATH_(\d+)@@/g, (_, idx) => mathMasked[+idx]);

    return masked;
}

/**
 * Parses a statement into an AST: swaps LaTeX `tabular`→`array` inside math,
 * extracts allowlisted HTML fragments, and parses everything else as BBCode.
 */
export function parseMathStatement(text: string): ASTNode[] {
    return parseWithHtml(preprocessFormatting(preprocessTabular(text)));
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
// Fenced code from the markdown dialect. `katex-ignore` for the same reason
// `[code]` carries it: a `$` inside code is not math.
const CODE_BLOCK_CLASS =
    "katex-ignore block font-mono text-xs leading-relaxed p-3 rounded-lg bg-surface-container-low/50 border border-border/60 overflow-x-auto text-foreground";
const ASY_IMG_CLASS = IMG_CLASS;
const ASY_PRE_CLASS =
    "katex-ignore block font-mono text-sm leading-relaxed p-4 my-3 rounded-lg bg-surface-container-low/50 border border-border/60 overflow-x-auto text-foreground max-h-[250px]";

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Reject URLs with a scheme outside the allowlist (blocks javascript:, etc.).
export function sanitizeUrl(url: string, allowed: string[], fallback: string): string {
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
        switch (node.type) {
            case "text":
            case "code":
            case "codeblock":
                text += node.content;
                break;
            case "table":
                for (const row of [...node.head, ...node.body]) {
                    for (const cell of row.cells) text += astText(cell.children);
                }
                break;
            case "list":
                for (const item of node.items) text += astText(item);
                break;
            // Childless nodes carry no inline text.
            case "asy":
            case "img":
            case "linebreak":
            case "rule":
                break;
            default:
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
            case "center":
                html += `<div class="pc-center">${astToHtml(node.children)}</div>`;
                break;
            case "paragraph":
                html += `<p>${astToHtml(node.children)}</p>`;
                break;
            case "heading": {
                // Clamped rather than trusted: the level reaches a tag name.
                const level = Math.min(6, Math.max(1, Math.round(node.level)));
                html += `<h${level}>${astToHtml(node.children)}</h${level}>`;
                break;
            }
            case "list": {
                const tag = node.ordered ? "ol" : "ul";
                const items = node.items
                    .map((item) => `<li>${astToHtml(item)}</li>`)
                    .join("");
                html += `<${tag}>${items}</${tag}>`;
                break;
            }
            case "blockquote":
                html += `<blockquote>${astToHtml(node.children)}</blockquote>`;
                break;
            case "codeblock":
                html += `<pre class="${CODE_BLOCK_CLASS}"><code>${escapeHtml(node.content)}</code></pre>`;
                break;
            case "linebreak":
                html += "<br />";
                break;
            case "rule":
                html += "<hr />";
                break;
        }
    }

    return html;
}

// Rebuild an allowlisted table as sanitized markup. Only the fixed tag set and
// a fixed class are emitted — no attribute from the source is ever reproduced —
// and cell contents run back through `astToHtml`, so they are escaped like any
// other inline text. The table is wrapped so wide tables scroll horizontally
// (`.pc-table-wrap`, styled globally in layout.css alongside `.pc-table`).
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

    let out = '<div class="pc-table-wrap"><table class="pc-table">';
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

function isWhitespaceOnly(nodes: ASTNode[]): boolean {
    for (const node of nodes) {
        if (node.type === "text") {
            if (node.content.trim().length > 0) return false;
        } else if (node.type === "linebreak") {
            continue;
        } else if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
            if (!isWhitespaceOnly((node as { children: ASTNode[] }).children)) return false;
        } else {
            return false;
        }
    }
    return true;
}

function getInteractiveSegment(node: ASTNode): StatementSegment | null {
    if (node.type === "asy") {
        const src = sanitizeUrl(
            node.imageSrc,
            ["http", "https", "data"],
            "",
        );
        if (src) {
            return { kind: "asy", imageSrc: src, code: node.code };
        }
    } else if (node.type === "img") {
        const src = sanitizeUrl(node.src, ["http", "https", "data"], "");
        if (src) {
            return { kind: "img", src, alt: node.label || "Image" };
        }
    }
    return null;
}

type ASTParentNode = Extract<ASTNode, { children: ASTNode[] }>;

function isSplittableContainer(node: ASTNode): node is ASTParentNode {
    return "children" in node && Array.isArray((node as { children?: unknown }).children);
}

function cloneContainer(container: ASTParentNode, children: ASTNode[]): ASTNode {
    return { ...container, children };
}

function hasInteractiveDescendant(nodes: ASTNode[]): boolean {
    for (const node of nodes) {
        if (getInteractiveSegment(node) !== null) return true;
        if (isSplittableContainer(node) && hasInteractiveDescendant(node.children)) {
            return true;
        }
    }
    return false;
}

export function segmentStatement(nodes: ASTNode[]): StatementSegment[] {
    const segments: StatementSegment[] = [];
    let buffer: ASTNode[] = [];

    function flush() {
        if (buffer.length > 0) {
            segments.push({ kind: "html", html: astToHtml(buffer) });
            buffer = [];
        }
    }

    function processContainer(container: ASTParentNode) {
        let subBuffer: ASTNode[] = [];
        for (const child of container.children) {
            const interactive = getInteractiveSegment(child);
            if (interactive) {
                if (subBuffer.length > 0 && !isWhitespaceOnly(subBuffer)) {
                    buffer.push(cloneContainer(container, subBuffer));
                }
                subBuffer = [];
                flush();
                segments.push(interactive);
                continue;
            }

            if (isSplittableContainer(child) && hasInteractiveDescendant(child.children)) {
                if (subBuffer.length > 0 && !isWhitespaceOnly(subBuffer)) {
                    buffer.push(cloneContainer(container, subBuffer));
                }
                subBuffer = [];
                processContainer(child);
                continue;
            }

            subBuffer.push(child);
        }

        if (subBuffer.length > 0 && !isWhitespaceOnly(subBuffer)) {
            buffer.push(cloneContainer(container, subBuffer));
        }
    }

    for (const node of nodes) {
        const interactive = getInteractiveSegment(node);
        if (interactive) {
            flush();
            segments.push(interactive);
            continue;
        }

        if (isSplittableContainer(node) && hasInteractiveDescendant(node.children)) {
            processContainer(node);
            continue;
        }

        buffer.push(node);
    }

    flush();
    return segments;
}
