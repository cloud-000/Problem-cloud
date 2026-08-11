// Shared answer-normalization + comparison for grading free-response answers.
// `answersMatch` is the single entry point for "is this answer right?" — every
// grading site in the app routes through it, so a rule added here applies to
// live practice, fixed tests, and re-grades of stored answers alike.
//
// Two layers, asked in order. This module is *lexical*: it canonicalizes
// cosmetic LaTeX and numeric spelling so equivalent renderings of the same
// answer compare equal (`\frac12` ≡ `1/2`), with no algebra. When that finds no
// match, `answer-value.ts` asks the independent question of whether both sides
// denote the same *number* (`1/2` ≡ `0.5` ≡ `\frac{2}{4}`). Neither layer does
// symbolic algebra: `\frac{a}{b}` and `a/b` match lexically, but nothing
// simplifies `\frac{2x}{4}` to `x/2`.

import { numericallyEqual } from "./answer-value";

/** Command aliases collapsed to a single canonical spelling. Keep small. */
const COMMAND_ALIASES: Record<string, string> = {
    "\\dfrac": "\\frac",
    "\\tfrac": "\\frac",
    "\\overline": "\\bar",
};

/** A single LaTeX "token": a `\command` name, or any single non-brace char. */
const TOKEN = "(\\\\[a-zA-Z]+|[^{}\\\\])";

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip a single surrounding math wrapper: `$…$`, `$$…$$`, `\(…\)`, `\[…\]`. */
function stripMathWrappers(input: string): string {
    let s = input.trim();
    const wrappers: [string, string][] = [
        ["$$", "$$"],
        ["$", "$"],
        ["\\(", "\\)"],
        ["\\[", "\\]"],
    ];
    for (const [open, close] of wrappers) {
        if (
            s.length >= open.length + close.length &&
            s.startsWith(open) &&
            s.endsWith(close)
        ) {
            return s.slice(open.length, s.length - close.length).trim();
        }
    }
    return s;
}

/** `.5` → `0.5` for a decimal that starts a number (not preceded by a digit). */
function padLeadingDecimals(s: string): string {
    return s.replace(/(^|[^0-9.])\.(?=\d)/g, (_m, p1: string) => `${p1}0.`);
}

/** Remove thousands separators inside numbers: `1,000,000` → `1000000`. */
function stripThousandsCommas(s: string): string {
    let prev: string;
    let out = s;
    do {
        prev = out;
        out = out.replace(/(\d),(\d{3})(?!\d)/, "$1$2");
    } while (out !== prev);
    return out;
}

/**
 * Lowercase every run of text that is NOT part of a `\command` name (LaTeX
 * commands are case-sensitive, e.g. `\pi` ≠ `\Pi`). If there is no backslash at
 * all, the whole string is plain text — lowercase it wholesale.
 */
function lowercaseNonCommands(s: string): string {
    if (!s.includes("\\")) return s.toLowerCase();

    let result = "";
    let last = 0;
    const re = /\\[a-zA-Z]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        result += s.slice(last, m.index).toLowerCase();
        result += m[0]; // command name: preserve case
        last = m.index + m[0].length;
    }
    result += s.slice(last).toLowerCase();
    return result;
}

/**
 * Helper to parse the next LaTeX argument following a command like \frac.
 * Handles braced groups like {123} as well as single tokens like \pi or 5.
 */
function parseNextLatexArg(rest: string): [string, string] {
    rest = rest.trimStart();
    if (rest.startsWith("{")) {
        let depth = 0;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "{") {
                depth++;
            } else if (rest[i] === "}") {
                depth--;
                if (depth === 0) {
                    const arg = rest.slice(1, i);
                    const remaining = rest.slice(i + 1);
                    return [arg, remaining];
                }
            }
        }
        return [rest.slice(1), ""]; // Fallback if unmatched braces
    } else if (rest.startsWith("\\")) {
        const match = rest.match(/^\\([a-zA-Z]+|.)/);
        if (match) {
            const arg = match[0];
            const remaining = rest.slice(arg.length);
            return [arg, remaining];
        }
        return ["", rest];
    } else if (rest.length > 0) {
        const arg = rest[0];
        const remaining = rest.slice(1);
        return [arg, remaining];
    }
    return ["", ""];
}

/**
 * Checks if a LaTeX argument string contains mathematical operations that would
 * require parenthesis grouping when translated to slash-based division notation.
 */
function needsParentheses(s: string, position: "numerator" | "denominator"): boolean {
    const trimmed = s.trim();
    // A *leading* minus is safe in a numerator — `\frac{-1}{2}` → `-1/2` reads
    // correctly — which is why the `-` scan below skips the first character.
    // In a denominator it is not: `\frac{a}{-b}` → `a/-b` is ambiguous, and
    // would never converge with the `a/(-b)` a student actually types.
    if (position === "denominator" && trimmed.startsWith("-")) return true;
    if (trimmed.includes("+")) return true;
    if (trimmed.slice(1).includes("-")) return true;
    if (trimmed.includes("*")) return true;
    if (trimmed.includes("/")) return true;
    if (/\\(pm|mp|times|div|cdot)/.test(trimmed)) return true;
    return false;
}

/**
 * A whole number written immediately before a fraction is a mixed number, so
 * the juxtaposition means addition: `2\frac12` is 2½, not 2×½. Requiring the
 * digits to be a standalone integer keeps this off genuine juxtaposition —
 * `\frac12\frac34` (a product) ends in digits too, but they are part of a
 * command, and `x\frac12` / `(1+2)\frac12` don't end in digits at all.
 */
function endsWithWholeNumber(before: string): boolean {
    return /(?:^|[^0-9a-zA-Z}\\])\d+$/.test(before);
}

/**
 * Recursively convert LaTeX fractions to standard division slash notation.
 * e.g., \frac{1}{4} -> 1/4, \frac{x+1}{y} -> (x+1)/y, 2\frac{1}{2} -> 2+1/2.
 */
function convertFracToSlash(s: string): string {
    let idx;
    while ((idx = s.lastIndexOf("\\frac")) !== -1) {
        const before = s.slice(0, idx);
        const rest = s.slice(idx + 5);
        const [arg1, rest1] = parseNextLatexArg(rest);
        const [arg2, rest2] = parseNextLatexArg(rest1);
        const formatArg1 = needsParentheses(arg1, "numerator") ? `(${arg1})` : arg1;
        const formatArg2 = needsParentheses(arg2, "denominator") ? `(${arg2})` : arg2;
        const join = endsWithWholeNumber(before) ? "+" : "";
        s = before + join + `${formatArg1}/${formatArg2}` + rest2;
    }
    return s;
}

/**
 * Strip units, currencies, labels, and percentage/degree notation.
 * e.g., "$5" -> "5", "5 cheeses" -> "5", "5 cm" -> "5", "5 m" -> "5", "5m" -> "5m"
 */
function stripUnitsAndLabels(s: string): string {
    let val = s.trim();

    // 1. Strip leading currency symbols. A leading `$` is only currency when
    //    it's unpaired; if a second `$` follows it's a `$…$` math delimiter
    //    (e.g. "$\frac{1}{4}$"), which must be left for normalizeAnswer.
    val = val.replace(/^[£€¥]\s*/g, "");
    if (val.startsWith("$") && !val.slice(1).includes("$")) {
        val = val.replace(/^\$\s*/, "");
    }

    // 2. Strip leading approximation words
    val = val.replace(/^(?:approx\.?|about|around)\s+/gi, "");

    // 3. Strip a trailing parenthesized word-label: "900 (pieces)", "48(cm)",
    //    "$\frac{1}{4}$ (square meters)". The parens must contain only letters,
    //    spaces, and dots (a label/unit, never a math expression like "(n+1)"
    //    or an ordered pair like "(a,b)"), and must follow an actual value (a
    //    non-space char) so a fully-parenthesized answer like "(x)" is left be.
    val = val.replace(/(\S)\s*\(\s*[a-zA-Z][a-zA-Z.\s]*\)\s*$/, "$1");

    // 4. Strip trailing word labels.
    // Units of 2+ characters can have optional space (e.g. 5cm, 5 cm).
    // Single character units (m, s, g, etc.) require at least one space (e.g. 5 m) to distinguish from variables.
    const unitRegex = /([\d})\]]|\\pi|\\theta|\\infty)(?:\s*[a-zA-Z]{2,}\.?|\s+[msglLhd]\.?)(?:\s+[a-zA-Z]+\.?)*$/;
    val = val.replace(unitRegex, "$1");

    // 5. Strip trailing percent or degree symbol/words
    val = val.replace(/\s*(?:%|°|percent|degrees?)\s*$/gi, "");

    // 6. Clean up any trailing period
    val = val.replace(/\.$/, "");

    return val.trim();
}

/** Text-mode wrappers whose braced content is the answer itself. */
const TEXT_COMMANDS = [
    "\\text",
    "\\textbf",
    "\\textit",
    "\\textrm",
    "\\mathrm",
    "\\mathbf",
    "\\mathit",
    "\\mbox",
    "\\operatorname",
];

/** Replace `\text{foo}` (and friends) with `foo`, innermost-outermost, to a fixed point. */
function unwrapTextCommands(s: string): string {
    for (let guard = 0; guard < 32; guard++) {
        let changed = false;
        for (const command of TEXT_COMMANDS) {
            const at = s.indexOf(command + "{");
            if (at === -1) continue;
            const [inner, rest] = parseNextLatexArg(s.slice(at + command.length));
            s = s.slice(0, at) + inner + rest;
            changed = true;
        }
        if (!changed) return s;
    }
    return s;
}

/**
 * Canonicalize a raw answer string into a comparable form. Purely lexical; see
 * the module header. Idempotent for already-normalized input.
 */
export function normalizeAnswer(raw: string): string {
    // 1. Trim + strip a surrounding math-mode wrapper.
    let s = stripMathWrappers(raw);

    // 2. Drop delimiter-sizing, spacing, and display commands (no semantic
    //    weight for grading). Lookaheads prevent chewing into longer names
    //    (`\left` must not match `\leftarrow`, `\quad` not `\quadrant`).
    s = s
        .replace(/\\left(?![a-zA-Z])/g, "")
        .replace(/\\right(?![a-zA-Z])/g, "")
        .replace(/\\displaystyle(?![a-zA-Z])/g, "")
        .replace(/\\(?:qquad|quad)(?![a-zA-Z])/g, "")
        .replace(/\\[!,;: ]/g, "");

    // 2a. Unwrap text-mode commands: the words inside are the answer, the
    //     command is only how they were typeset (`\text{none}` → `none`).
    s = unwrapTextCommands(s);

    // 2b. Fold the dash characters a keyboard, a PDF, and KaTeX each produce
    //     for the same minus sign onto ASCII `-`.
    s = s.replace(/[−‒–—]/g, "-");

    // 3. Collapse command aliases to their canonical spelling.
    for (const [from, to] of Object.entries(COMMAND_ALIASES)) {
        s = s.replace(new RegExp(escapeRegExp(from) + "(?![a-zA-Z])", "g"), to);
    }

    // 4. Convert LaTeX fractions to slash-based division notation.
    s = convertFracToSlash(s);

    // 5. Remove braces around a single token, to a fixed point: `{x}` → `x`.
    let prev: string;
    do {
        prev = s;
        s = s.replace(new RegExp("\\{" + TOKEN + "\\}", "g"), "$1");
    } while (s !== prev);

    // 6. Remove parentheses around single numbers, words, or latex commands, to a fixed point.
    //    e.g. (18) -> 18, (1.5) -> 1.5, (\pi) -> \pi, (x) -> x.
    do {
        prev = s;
        s = s.replace(/\(([a-zA-Z]+|\d+(?:\.\d+)?|\\\\[a-zA-Z]+)\)/g, "$1");
    } while (s !== prev);

    // 6a. Escaped braces are a *set*, not a LaTeX group, so they are unescaped
    //     only now — after group-stripping, which must not consume them.
    //     `\{1,2\}` and `{1,2}` then agree, while `{x}` still reduces to `x`.
    s = s.replace(/\\([{}])/g, "$1");

    // 7. Numeric canonicalization: thousands commas + leading decimals.
    s = stripThousandsCommas(s);
    s = padLeadingDecimals(s);

    // 8. Drop all whitespace, then case-fold everything but command names.
    s = s.replace(/\s+/g, "");
    s = lowercaseNonCommands(s);

    return s;
}

/**
 * Drop a `variable =` prefix, so restating the question ("x = 5") compares as
 * the value it asserts. Only a bare single-variable left side qualifies, and
 * only one side of a comparison may ever be stripped — see `assignmentForms`.
 */
function stripVariableAssignment(s: string): string {
    const match = /^(?:[a-zA-Z]|\\[a-zA-Z]+)(?:_\{?[a-zA-Z0-9]+\}?)?=(.+)$/.exec(s);
    return match ? match[1] : s;
}

/**
 * The comparable forms of `a` and `b` once at most *one* of them has shed a
 * `variable =` prefix. Stripping both would equate `y=2x+1` with `z=2x+1`,
 * which name different things; stripping neither would fail `x=5` against `5`.
 */
function assignmentForms(a: string, b: string): [string, string][] {
    return [
        [stripVariableAssignment(a), b],
        [a, stripVariableAssignment(b)],
    ];
}

/**
 * True when `a` and `b` represent the same answer, checked in widening tiers —
 * each is a strictly weaker notion of sameness than the last, so the first hit
 * wins and a miss costs only the next comparison:
 *   1. exact (trimmed) string equality,
 *   2. lexical equality after normalization (`\dfrac12` == `1/2`),
 *   3. lexical equality ignoring a `x =` prefix on either side,
 *   4. numeric value equality (`1/2` == `0.5` == `\frac{2}{4}`), which applies
 *      only when *both* sides are closed arithmetic — see `answer-value.ts`.
 * No symbolic algebra is performed at any tier.
 */
export function answersMatch(a: string, b: string): boolean {
    const cleanA = stripUnitsAndLabels(a);
    const cleanB = stripUnitsAndLabels(b);

    if (cleanA.trim() === cleanB.trim()) return true;

    const na = normalizeAnswer(cleanA);
    const nb = normalizeAnswer(cleanB);
    if (na === nb) return true;

    for (const [formA, formB] of assignmentForms(na, nb)) {
        if (formA === formB) return true;
        if (numericallyEqual(formA, formB)) return true;
    }

    // Fallback to raw comparison (in case stripping stripped too much)
    if (a.trim() === b.trim()) return true;
    if (normalizeAnswer(a) === normalizeAnswer(b)) return true;

    return false;
}
