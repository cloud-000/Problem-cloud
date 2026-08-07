/**
 * The markdown dialect: prose written *by a model*, parsed into the same AST the
 * BBCode statement parser produces (`math-parser.ts`) and rendered by the same
 * `astToHtml` / `segmentStatement`.
 *
 * Why this exists rather than a markdown library: every general-purpose parser
 * mangles LaTeX. `_` becomes emphasis inside `x_1`, `*` becomes bold inside
 * `a*b*c`, and `\[` gets escaped. This dialect **masks every math region before
 * any block or inline rule runs** and restores it afterwards, so markup and math
 * cannot collide by construction — the same trick `[code]`/`[asy]` already use
 * via `captureVerbatim`. That guarantee, not the syntax coverage, is the reason
 * this is ~250 lines of our own.
 *
 * Why it is a separate dialect rather than an upgrade to the statement parser:
 * problem statements are a single implicit paragraph of BBCode, and giving that
 * path block structure would change how every problem in the app renders. The
 * two share the AST and the renderer, and nothing else.
 *
 * Deliberately not supported:
 *  - `_italic_` / `_bold_`. Subscripts written outside math (`x_1`, `a_i`) are
 *    far more common in this app than underscore emphasis, and one false
 *    positive there silently eats characters out of a hint.
 *  - BBCode tags. One dialect per surface; a coach echoing `[asy]` back reads as
 *    literal text, which is safe, rather than opening a verbatim capture that
 *    swallows the rest of the reply.
 */

import {
    astToHtml,
    MATH_REGION_REGEX,
    resolveImageSrc,
    type ASTNode,
    type TableCell,
    type TableRow,
} from "./math-parser";

// Private-use codepoints: they cannot occur in model output, survive every
// string operation between masking and restoring, and are not HTML-special.
const MASK_OPEN = "\uE000";
const MASK_CLOSE = "\uE001";
const MASK_PATTERN = /\uE000(\d+)\uE001/g;

interface Masked {
    text: string;
    regions: string[];
}

/** Replace every `$…$` / `\[…\]` region with an opaque token. */
function maskMath(text: string): Masked {
    const regions: string[] = [];
    const regex = new RegExp(MATH_REGION_REGEX.source, "g");
    const masked = text.replace(regex, (region) => {
        regions.push(region);
        return `${MASK_OPEN}${regions.length - 1}${MASK_CLOSE}`;
    });
    return { text: masked, regions };
}

function unmask(text: string, regions: Masked["regions"]): string {
    if (!text.includes(MASK_OPEN)) return text;
    return text.replace(MASK_PATTERN, (token, index: string) => regions[Number(index)] ?? token);
}

/**
 * Put the math back into every text-bearing node.
 *
 * Restoring into the AST rather than into the final HTML keeps math on exactly
 * the path it has always taken: `astToHtml` escapes it, and KaTeX reads the
 * decoded text content back out of the DOM. Restoring after escaping would leave
 * a `<` inside math un-escaped and break the injected markup.
 */
function unmaskNodes(nodes: ASTNode[], regions: Masked["regions"]): ASTNode[] {
    return nodes.map((node) => {
        switch (node.type) {
            case "text":
                return { ...node, content: unmask(node.content, regions) };
            case "code":
            case "codeblock":
                return { ...node, content: unmask(node.content, regions) };
            case "list":
                return {
                    ...node,
                    items: node.items.map((item) => unmaskNodes(item, regions)),
                };
            case "table":
                return {
                    ...node,
                    head: unmaskRows(node.head, regions),
                    body: unmaskRows(node.body, regions),
                };
            case "asy":
            case "img":
            case "linebreak":
            case "rule":
                return node;
            default:
                return { ...node, children: unmaskNodes(node.children, regions) };
        }
    });
}

function unmaskRows(rows: TableRow[], regions: Masked["regions"]): TableRow[] {
    return rows.map((row) => ({
        cells: row.cells.map((cell) => ({
            ...cell,
            children: unmaskNodes(cell.children, regions),
        })),
    }));
}

// --- Inline ----------------------------------------------------------------
//
// One left-to-right alternation, tried in precedence order. Emphasis bodies
// require a non-space first and last character so `2 * 3 * 4` and `a ** b` stay
// arithmetic; code spans win over everything so `` `**not bold**` `` is literal.
// No lookbehind anywhere — a regex that throws at module scope would take the
// whole renderer down on older Safari.
const INLINE_REGEX = new RegExp(
    [
        "(`+)([\\s\\S]*?)\\1", // 1,2  code span
        "!\\[([^\\]]*)\\]\\(\\s*([^\\s)]+)\\s*\\)", // 3,4  image
        "\\[([^\\]]*)\\]\\(\\s*([^\\s)]+)\\s*\\)", // 5,6  link
        "\\*\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*\\*", // 7    **bold**
        "__([^\\s_](?:[\\s\\S]*?[^\\s_])?)__", // 8    __bold__
        "~~([^\\s~](?:[\\s\\S]*?[^\\s~])?)~~", // 9    ~~strike~~
        "\\*([^\\s*](?:[^*]*[^\\s*])?)\\*", // 10   *italic*
    ].join("|"),
    "g",
);

function parseInline(text: string): ASTNode[] {
    const nodes: ASTNode[] = [];
    const regex = new RegExp(INLINE_REGEX.source, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const pushText = (value: string) => {
        if (value) nodes.push({ type: "text", content: value });
    };

    while ((match = regex.exec(text)) !== null) {
        pushText(text.slice(lastIndex, match.index));
        lastIndex = regex.lastIndex;

        if (match[2] !== undefined) {
            // A code span's body is verbatim: never re-parsed for markup.
            nodes.push({ type: "code", content: match[2] });
        } else if (match[4] !== undefined) {
            nodes.push({ type: "img", label: match[3], src: resolveImageSrc(match[4]) });
        } else if (match[6] !== undefined) {
            nodes.push({ type: "url", href: match[6], children: parseInline(match[5]) });
        } else if (match[7] !== undefined) {
            nodes.push({ type: "bold", children: parseInline(match[7]) });
        } else if (match[8] !== undefined) {
            nodes.push({ type: "bold", children: parseInline(match[8]) });
        } else if (match[9] !== undefined) {
            nodes.push({ type: "strikethrough", children: parseInline(match[9]) });
        } else if (match[10] !== undefined) {
            nodes.push({ type: "italic", children: parseInline(match[10]) });
        }
    }

    pushText(text.slice(lastIndex));
    return nodes;
}

/**
 * Inline content of one block, with single newlines kept as hard breaks.
 *
 * Markdown proper folds a lone newline into a space. Models do not write that
 * way — they put each step of a derivation on its own line and expect them to
 * stay there — and a chat surface that silently reflows those into a paragraph
 * is exactly the wall of text this dialect exists to fix.
 */
function parseInlineWithBreaks(text: string): ASTNode[] {
    const nodes: ASTNode[] = [];
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
        if (index > 0) nodes.push({ type: "linebreak" });
        nodes.push(...parseInline(line));
    }
    return nodes;
}

// --- Blocks ----------------------------------------------------------------

const FENCE = /^\s*(`{3,}|~{3,})\s*[\w+-]*\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

/** Split a `| a | b |` row into its cell texts. */
function tableCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function toCells(line: string, header: boolean): TableCell[] {
    return tableCells(line).map((cell) => ({ header, children: parseInline(cell) }));
}

function parseBlocks(text: string): ASTNode[] {
    const lines = text.split("\n");
    const nodes: ASTNode[] = [];
    let index = 0;

    // Consecutive non-blank, non-block-opening lines, joined back together.
    const paragraph: string[] = [];
    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        const children = parseInlineWithBreaks(paragraph.join("\n"));
        paragraph.length = 0;
        if (children.length > 0) nodes.push({ type: "paragraph", children });
    };

    while (index < lines.length) {
        const line = lines[index];

        if (!line.trim()) {
            flushParagraph();
            index += 1;
            continue;
        }

        const fence = FENCE.exec(line);
        if (fence) {
            flushParagraph();
            const marker = fence[1][0];
            const body: string[] = [];
            index += 1;
            while (index < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[index])) {
                body.push(lines[index]);
                index += 1;
            }
            index += 1; // The closing fence, or past the end if it never came.
            nodes.push({ type: "codeblock", content: body.join("\n") });
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            flushParagraph();
            nodes.push({
                type: "heading",
                level: heading[1].length,
                children: parseInline(heading[2].trim()),
            });
            index += 1;
            continue;
        }

        // Checked before the list forms, so `- - -` reads as a rule rather than a
        // bullet whose content happens to be `- -`.
        if (RULE.test(line)) {
            flushParagraph();
            nodes.push({ type: "rule" });
            index += 1;
            continue;
        }

        if (QUOTE.test(line)) {
            flushParagraph();
            const body: string[] = [];
            while (index < lines.length) {
                const quoted = QUOTE.exec(lines[index]);
                if (!quoted) break;
                body.push(quoted[1]);
                index += 1;
            }
            nodes.push({ type: "blockquote", children: parseBlocks(body.join("\n")) });
            continue;
        }

        if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
            flushParagraph();
            const head: TableRow[] = [{ cells: toCells(line, true) }];
            const body: TableRow[] = [];
            index += 2;
            while (index < lines.length && TABLE_ROW.test(lines[index])) {
                body.push({ cells: toCells(lines[index], false) });
                index += 1;
            }
            nodes.push({ type: "table", head, body });
            continue;
        }

        const bullet = BULLET.exec(line);
        const ordered = ORDERED.exec(line);
        if (bullet || ordered) {
            flushParagraph();
            const isOrdered = ordered !== null && bullet === null;
            const items: ASTNode[][] = [];
            let current: string[] = [];

            const flushItem = () => {
                if (current.length === 0) return;
                items.push(parseInlineWithBreaks(current.join("\n").trim()));
                current = [];
            };

            while (index < lines.length) {
                const row = lines[index];
                if (!row.trim()) {
                    // A blank line ends the list unless another item follows it.
                    const next = lines[index + 1] ?? "";
                    const continues = isOrdered ? ORDERED.test(next) : BULLET.test(next);
                    if (!continues) break;
                    index += 1;
                    continue;
                }
                const item = isOrdered ? ORDERED.exec(row) : BULLET.exec(row);
                if (item) {
                    flushItem();
                    current.push(item[3]);
                    index += 1;
                    continue;
                }
                // A line that opens some other block ends the list; anything else
                // is a continuation of the item in progress.
                if (
                    HEADING.test(row) ||
                    FENCE.test(row) ||
                    QUOTE.test(row) ||
                    RULE.test(row) ||
                    (isOrdered ? BULLET.test(row) : ORDERED.test(row))
                ) {
                    break;
                }
                current.push(row.trim());
                index += 1;
            }
            flushItem();
            if (items.length > 0) nodes.push({ type: "list", ordered: isOrdered, items });
            continue;
        }

        paragraph.push(line);
        index += 1;
    }

    flushParagraph();
    return nodes;
}

/**
 * Parse model-authored markdown into the shared AST.
 *
 * Order matters: mask math, parse structure, restore math. Nothing between the
 * first and last step can see a `$`, which is the whole point.
 */
export function parseMarkdown(text: string): ASTNode[] {
    const { text: masked, regions } = maskMath(text);
    return unmaskNodes(parseBlocks(masked), regions);
}

/** Convenience for callers that want HTML directly (tests, non-Svelte call sites). */
export function markdownToHtml(text: string): string {
    return astToHtml(parseMarkdown(text));
}
