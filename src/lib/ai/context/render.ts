import type {
    FactWarning,
    ProblemFact,
    ResolvedFact,
    SeriesFact,
    TestFact,
} from "./facts";

const MAX_FACTS = 12;
export const MAX_FACT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 12_000;
export const CONTEXT_SECTION_SEPARATOR = "\n\n---\n\n";
export const CONTEXT_TRUNCATION_MARKER = "[truncated]";
const STATEMENT_TRUNCATION_MARKER = "[statement truncated]";
const PROBLEM_TAIL_RESERVED_CHARS = 1_600;
const MIN_SECTION_CHARS = 32;
const MIN_LINE_CHARS = 32;

function warningLines(warnings: FactWarning[]): string[] {
    return warnings.map((warning) => `Warning: ${warning.message}`);
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

/** Section-aware, visibly marked truncation that never cuts inside a LaTeX span. */
export function truncateContextText(
    text: string,
    maxChars: number,
    marker = CONTEXT_TRUNCATION_MARKER,
): string {
    if (text.length <= maxChars) return text;
    const suffix = `\n${marker}`;
    if (maxChars < suffix.length) return "";
    const limit = maxChars - suffix.length;
    const cut = safePrefixLength(text, limit);
    const prefix = text.slice(0, cut).trimEnd();
    return prefix ? `${prefix}${suffix}` : marker;
}

function fitLines(lines: string[], maxChars: number): string[] {
    if (lines.join("\n").length <= maxChars) return lines;
    if (lines.length === 0) return [];
    const maxVisible = Math.max(1, Math.floor(maxChars / MIN_LINE_CHARS) - 1);
    const visible = lines.slice(0, maxVisible);
    const omitted = lines.length - visible.length;
    const bounded = omitted > 0
        ? [...visible, `[${omitted} additional lines truncated]`]
        : visible;
    const available = Math.max(0, maxChars - (bounded.length - 1));
    const perLine = Math.floor(available / bounded.length);
    return bounded
        .map((line) => truncateContextText(line, perLine))
        .filter(Boolean);
}

export function renderProblem(fact: ProblemFact): string {
    const header = "Problem currently in view:";
    const tail = [
        ...(fact.choices ?? []).map(
            (choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`,
        ),
        ...warningLines(fact.warnings),
    ];
    const fittedTail = fitLines(tail, PROBLEM_TAIL_RESERVED_CHARS);
    const tailText = fittedTail.join("\n");
    const fixedChars = header.length + 1 + (tailText ? tailText.length + 1 : 0);
    const statement = truncateContextText(
        fact.statement,
        Math.max(0, MAX_FACT_CHARS - fixedChars),
        STATEMENT_TRUNCATION_MARKER,
    );
    const lines = [header, statement];
    if (tailText) {
        lines.push(tailText);
    }
    return lines.filter(Boolean).join("\n");
}

function renderTest(fact: TestFact): string {
    return [`Test: ${fact.name}`, fact.series ? `Series: ${fact.series}` : "", ...warningLines(fact.warnings)]
        .filter(Boolean)
        .join("\n");
}

function renderSeries(fact: SeriesFact): string {
    return [`Series: ${fact.name}`, ...warningLines(fact.warnings)].join("\n");
}

function renderFact(fact: ResolvedFact): string {
    let rendered: string;
    switch (fact.kind) {
        case "problem":
            rendered = renderProblem(fact);
            break;
        case "test":
            rendered = renderTest(fact);
            break;
        case "series":
            rendered = renderSeries(fact);
            break;
        case "selection":
            rendered = `Selected context:\n${truncateContextText(
                fact.text,
                MAX_FACT_CHARS - "Selected context:\n".length,
            )}`;
            break;
    }
    return truncateContextText(rendered, MAX_FACT_CHARS);
}

/** One bounded, independently budgetable section per fact. */
export function renderFactSections(facts: ResolvedFact[]): string[] {
    return facts
        .slice(0, MAX_FACTS)
        .map(renderFact)
        .filter(Boolean);
}

export function minimumContextChars(sections: string[]): number {
    if (sections.length === 0) return 0;
    return (
        CONTEXT_SECTION_SEPARATOR.length * (sections.length - 1) +
        sections.reduce(
            (total, section) => Math.min(section.length, MIN_SECTION_CHARS) + total,
            0,
        )
    );
}

/** Fits whole fact sections into a budget; every omission is explicitly marked. */
export function fitContextSections(sections: string[], maxChars: number): string {
    if (sections.length === 0 || maxChars <= 0) return "";
    let fitted = [...sections];
    let omitted = 0;
    while (fitted.length > 1 && minimumContextChars(fitted) > maxChars) {
        fitted.pop();
        omitted += 1;
    }
    if (omitted > 0) {
        const omission = `[${omitted} context sections truncated]`;
        while (
            fitted.length > 0 &&
            minimumContextChars([...fitted, omission]) > maxChars
        ) {
            fitted.pop();
            omitted += 1;
        }
        fitted.push(`[${omitted} context sections truncated]`);
    }

    const separatorChars = CONTEXT_SECTION_SEPARATOR.length * (fitted.length - 1);
    if (maxChars <= separatorChars) return "";
    const full = fitted.join(CONTEXT_SECTION_SEPARATOR);
    if (full.length <= maxChars) return full;

    const budgets = fitted.map((section) => Math.min(section.length, MIN_SECTION_CHARS));
    let remaining = maxChars - separatorChars - budgets.reduce((sum, value) => sum + value, 0);
    if (remaining < 0) return "";
    for (let index = 0; index < fitted.length && remaining > 0; index += 1) {
        const extra = Math.min(remaining, fitted[index].length - budgets[index]);
        budgets[index] += extra;
        remaining -= extra;
    }

    return fitted
        .map((section, index) => truncateContextText(section, budgets[index]))
        .filter(Boolean)
        .join(CONTEXT_SECTION_SEPARATOR);
}

/** Deterministic, centrally budgeted model context. */
export function renderFacts(facts: ResolvedFact[]): string {
    return fitContextSections(renderFactSections(facts), MAX_CONTEXT_CHARS);
}
