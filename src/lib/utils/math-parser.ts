export type ASTNode =
    | { type: "text"; content: string }
    | { type: "bold"; children: ASTNode[] }
    | { type: "italic"; children: ASTNode[] }
    | { type: "underline"; children: ASTNode[] }
    | { type: "strikethrough"; children: ASTNode[] }
    | { type: "url"; href: string; children: ASTNode[] }
    | { type: "code"; content: string }
    | { type: "asy"; imageSrc: string; code: string }
    | { type: "img"; src: string; label: string };

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
 * Parses BBCode text into an AST.
 * Verbatim tags (like [code] and [asy]) capture all tokens inside them as plain text.
 */
export function parseMathStatement(text: string): ASTNode[] {
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
                nodes.push({ type: "text", content: token.content });
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
        }
    }

    return html;
}

// --- Segmentation ---------------------------------------------------------
//
// An asy diagram with a valid image is rendered as a real interactive Svelte
// component (toggle code/image, expand, invert), which cannot live inside the
// KaTeX clone in LaTeX.svelte. So the top-level statement is split into an
// ordered list of segments: runs of inline markup become a single `html`
// segment (rendered via one <LaTeX>), and each image-bearing asy node becomes
// its own `asy` segment (rendered as <AsyImage>) sitting between them.

export type StatementSegment =
    | { kind: "html"; html: string }
    | { kind: "asy"; imageSrc: string; code: string };

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
        buffer.push(node);
    }

    flush();
    return segments;
}
