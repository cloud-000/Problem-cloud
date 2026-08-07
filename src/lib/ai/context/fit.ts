/**
 * The layout engine for model-facing text: it decides how much of a document fits, and
 * nothing whatsoever about what the document says.
 *
 * Every word, marker, and separator arrives *inside* the `Doc` it is handed, so this
 * module contains no model-facing string at all. That is the whole point: while context
 * was built as strings, each block's layout had to live wherever its char arithmetic
 * lived, which is what scattered composition across the renderer. A document can be
 * declared without knowing its budget, so shapes live with the words in `$lib/ai/prompt.ts`
 * and all the arithmetic collapses into the one algorithm below.
 *
 * It replaces three ad-hoc fitters that each did "shed items, then divide the remainder"
 * by slightly different rules.
 */

const DEFAULT_MIN_CHARS = 32;

/** How a node competes for space. Defaults suit ordinary prose. */
export interface Sizing {
    /** Chars to keep even under pressure, before the node is dropped entirely. */
    min?: number;
    /** Chars this node may never exceed, however much budget is spare. */
    cap?: number;
    /** In a `ranked` group, higher claims spare budget first. Defaults to source order. */
    priority?: number;
}

export type Doc =
    | (Sizing & { kind: "text"; text: string; elision: string })
    /** A literal line — a tag — above a body that is charged for it. */
    | (Sizing & { kind: "prefix"; prefix: string; body: Doc })
    | (Sizing & {
          kind: "group";
          docs: Doc[];
          separator: string;
          elision: (omitted: number) => string;
          distribute: Distribution;
      });

/**
 * `even` splits the remainder equally — for peers that deserve the same room, like the
 * options of a multiple-choice problem. `ranked` satisfies each node's minimum, then
 * spends what is left in descending order of the sizing hint of the same name.
 */
export type Distribution = "even" | "ranked";

export function text(content: string, elision: string, sizing: Sizing = {}): Doc {
    return { kind: "text", text: content, elision, ...sizing };
}

export function prefixed(prefix: string, body: Doc, sizing: Sizing = {}): Doc {
    return { kind: "prefix", prefix, body, ...sizing };
}

export interface GroupOptions extends Sizing {
    separator: string;
    elision: (omitted: number) => string;
    distribute?: Distribution;
}

export function group(docs: Doc[], options: GroupOptions): Doc {
    const { separator, elision, distribute = "ranked", ...sizing } = options;
    // Empty children are dropped here so no downstream step has to filter them, and so
    // an all-empty group reports zero size rather than a run of separators.
    return {
        kind: "group",
        docs: docs.filter((doc) => maxChars(doc) > 0),
        separator,
        elision,
        distribute,
        ...sizing,
    };
}

/** Chars this document would occupy in full. */
export function maxChars(doc: Doc): number {
    let natural: number;
    switch (doc.kind) {
        case "text":
            natural = doc.text.length;
            break;
        case "prefix": {
            const body = maxChars(doc.body);
            natural = body === 0 ? 0 : doc.prefix.length + 1 + body;
            break;
        }
        case "group":
            natural =
                doc.docs.length === 0
                    ? 0
                    : doc.docs.reduce((total, child) => total + maxChars(child), 0) +
                      doc.separator.length * (doc.docs.length - 1);
            break;
    }
    return Math.min(natural, doc.cap ?? Number.MAX_SAFE_INTEGER);
}

/** Chars below which this document is no longer worth including at all. */
export function minChars(doc: Doc): number {
    const full = maxChars(doc);
    if (full === 0) return 0;
    let floorChars: number;
    switch (doc.kind) {
        case "text":
            floorChars = DEFAULT_MIN_CHARS;
            break;
        case "prefix":
            // A block that loses its tag line is unreadable, so the tag is never optional.
            floorChars = doc.prefix.length + 1 + minChars(doc.body);
            break;
        case "group":
            floorChars =
                doc.docs.reduce((total, child) => total + minChars(child), 0) +
                doc.separator.length * Math.max(0, doc.docs.length - 1);
            break;
    }
    return Math.min(full, Math.max(doc.min ?? 0, floorChars));
}

export function fit(doc: Doc, budget: number): string {
    const limit = Math.min(budget, doc.cap ?? Number.MAX_SAFE_INTEGER);
    if (limit <= 0) return "";
    switch (doc.kind) {
        case "text":
            return truncate(doc.text, limit, doc.elision);
        case "prefix": {
            const body = fit(doc.body, limit - (doc.prefix.length + 1));
            return body ? `${doc.prefix}\n${body}` : "";
        }
        case "group":
            return fitGroup(doc, limit);
    }
}

/** An elision marker earns its own space and is never itself shortened. */
function markerDoc(marker: string): Doc {
    return text(marker, marker, { min: marker.length, cap: marker.length });
}

function fitGroup(doc: Doc & { kind: "group" }, limit: number): string {
    if (doc.docs.length === 0) return "";
    const packed = (docs: Doc[]) =>
        docs.reduce((total, child) => total + minChars(child), 0) +
        doc.separator.length * Math.max(0, docs.length - 1);

    let kept = [...doc.docs];
    let omitted = 0;
    while (kept.length > 1 && packed(kept) > limit) {
        kept.pop();
        omitted += 1;
    }
    if (omitted > 0) {
        let marker = markerDoc(doc.elision(omitted));
        while (kept.length > 0 && packed([...kept, marker]) > limit) {
            kept.pop();
            omitted += 1;
            marker = markerDoc(doc.elision(omitted));
        }
        kept.push(marker);
    }

    const separators = doc.separator.length * (kept.length - 1);
    if (limit <= separators) return "";
    const available = limit - separators;
    const budgets =
        doc.distribute === "even" ? evenBudgets(kept, available) : rankedBudgets(kept, available);
    return kept
        .map((child, index) => fit(child, budgets[index]))
        .filter(Boolean)
        .join(doc.separator);
}

/**
 * Waterfilling: shortest first, each taking an equal share of whatever is still
 * unclaimed. A child that wants less than its share leaves the surplus to the rest, so a
 * flat split can never truncate a long peer while a short one sits under-spent — which is
 * how a problem's last choice used to vanish while its first four had room to spare.
 */
function evenBudgets(docs: Doc[], available: number): number[] {
    const wants = docs.map(maxChars);
    const budgets = docs.map(() => 0);
    let remaining = available;
    wants
        .map((want, index) => ({ want, index }))
        .sort((a, b) => a.want - b.want)
        .forEach(({ want, index }, position) => {
            const share = Math.floor(remaining / (docs.length - position));
            budgets[index] = Math.min(want, share);
            remaining -= budgets[index];
        });
    return budgets;
}

function rankedBudgets(docs: Doc[], available: number): number[] {
    const budgets = docs.map(minChars);
    const committed = budgets.reduce((sum, value) => sum + value, 0);
    // Not reachable while callers bound their inputs, but keep the degenerate case
    // deterministic rather than letting the remainder go negative.
    if (committed > available) return evenBudgets(docs, available);

    let remaining = available - committed;
    const order = docs
        .map((child, index) => ({ index, priority: child.priority ?? docs.length - index }))
        .sort((a, b) => b.priority - a.priority);
    for (const { index } of order) {
        if (remaining === 0) break;
        const extra = Math.min(remaining, maxChars(docs[index]) - budgets[index]);
        budgets[index] += extra;
        remaining -= extra;
    }
    return budgets;
}

function escaped(text: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
}

/**
 * Finds a prefix boundary outside supported LaTeX delimiters. A visibly marked
 * omission is preferable to handing a provider a half-open math expression.
 */
function safePrefixLength(text: string, limit: number): number {
    let math: "$" | "$$" | "\\(" | "\\[" | null = null;
    let lastOutside = 0;
    let lastNatural = 0;
    let index = 0;

    while (index < Math.min(limit, text.length)) {
        if (math === null) {
            if (text.startsWith("$$", index) && !escaped(text, index)) {
                math = "$$";
                index += 2;
                continue;
            }
            if (text[index] === "$" && !escaped(text, index)) {
                math = "$";
                index += 1;
                continue;
            }
            if (
                (text.startsWith("\\(", index) || text.startsWith("\\[", index)) &&
                !escaped(text, index)
            ) {
                math = text.slice(index, index + 2) as "\\(" | "\\[";
                index += 2;
                continue;
            }

            index += 1;
            lastOutside = index;
            if (/\s|[.!?;:,]/.test(text[index - 1] ?? "")) lastNatural = index;
            continue;
        }

        const closing = math === "\\(" ? "\\)" : math === "\\[" ? "\\]" : math;
        if (text.startsWith(closing, index) && !escaped(text, index)) {
            index += closing.length;
            math = null;
            lastOutside = index;
            lastNatural = index;
            continue;
        }
        index += 1;
    }

    const naturalEnough = lastNatural >= Math.floor(limit * 0.6);
    return naturalEnough ? lastNatural : lastOutside;
}

/** Visibly marked truncation that never cuts inside a LaTeX span. */
export function truncate(text: string, maxChars: number, marker: string): string {
    if (text.length <= maxChars) return text;
    const suffix = `\n${marker}`;
    if (maxChars < suffix.length) return "";
    const cut = safePrefixLength(text, maxChars - suffix.length);
    const prefix = text.slice(0, cut).trimEnd();
    return prefix ? `${prefix}${suffix}` : marker;
}
