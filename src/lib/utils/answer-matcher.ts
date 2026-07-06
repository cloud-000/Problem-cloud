// Shared answer-normalization + comparison for grading free-response answers.
//
// This is deliberately *lexical*, not symbolic: it canonicalizes cosmetic LaTeX
// and numeric variation so equivalent renderings of the same answer compare
// equal, but it performs no CAS/algebraic evaluation. `1/2` and `\frac12`
// normalize to the same string; `1/2` and `0.5` do NOT (that would require CAS).

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

    // 3. Collapse command aliases to their canonical spelling.
    for (const [from, to] of Object.entries(COMMAND_ALIASES)) {
        s = s.replace(new RegExp(escapeRegExp(from) + "(?![a-zA-Z])", "g"), to);
    }

    // 4. Expand single-token frac args: `\frac12` → `\frac{1}{2}`. Already-braced
    //    args are skipped (a `{` is not a single-char token).
    s = s.replace(
        new RegExp("\\\\frac\\s*" + TOKEN + "\\s*" + TOKEN, "g"),
        "\\frac{$1}{$2}",
    );

    // 5. Remove braces around a single token, to a fixed point: `{x}` → `x`.
    //    (This also re-collapses the fracs from step 4, so `\frac12` and
    //    `\frac{1}{2}` converge on the same canonical string.)
    let prev: string;
    do {
        prev = s;
        s = s.replace(new RegExp("\\{" + TOKEN + "\\}", "g"), "$1");
    } while (s !== prev);

    // 6. Numeric canonicalization: thousands commas + leading decimals.
    s = stripThousandsCommas(s);
    s = padLeadingDecimals(s);

    // 7. Drop all whitespace, then case-fold everything but command names.
    s = s.replace(/\s+/g, "");
    s = lowercaseNonCommands(s);

    return s;
}

/** Parse `s` as a plain finite decimal number, or null if it isn't one. */
function parsePlainNumber(s: string): number | null {
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * True when `a` and `b` represent the same answer, checked in tiers:
 *   1. exact (trimmed) string equality,
 *   2. normalized (lexical) equality,
 *   3. numeric equality when *both* normalize to plain finite numbers
 *      (so `1.50` == `1.5`). No symbolic/CAS evaluation is performed.
 */
export function answersMatch(a: string, b: string): boolean {
    if (a.trim() === b.trim()) return true;

    const na = normalizeAnswer(a);
    const nb = normalizeAnswer(b);
    if (na === nb) return true;

    const fa = parsePlainNumber(na);
    const fb = parsePlainNumber(nb);
    if (fa !== null && fb !== null) return fa === fb;

    return false;
}
