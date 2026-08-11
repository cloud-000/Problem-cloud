// Numeric *value* evaluation for answers, the tier below lexical matching.
//
// `answer-matcher.ts` canonicalizes spelling; this module asks the different
// question "do these two strings denote the same number?", so `1/2`, `0.5`,
// `\frac{2}{4}` and `2^{-1}` all compare equal. It is a closed arithmetic
// evaluator, NOT a CAS: it has no variables, no symbolic simplification, and no
// user-supplied functions. Anything it does not fully understand — a letter, an
// unknown command, an unbalanced brace — evaluates to `null`, which the matcher
// reads as "no opinion" and falls back to lexical comparison. Returning `null`
// is always safe; returning a wrong number is not, so every ambiguous
// construct below is resolved toward `null`.

/**
 * Values beyond this are treated as unevaluatable. Answers are competition
 * results, so anything larger is an exponent blow-up (`9^{9^9}`) rather than a
 * real answer, and comparing such magnitudes in float is meaningless anyway.
 */
const MAX_ABS = 1e15;

/** Exponents past this can't produce a comparable value; bail before computing. */
const MAX_EXPONENT = 1024;

/**
 * Relative tolerance for float noise (`0.1+0.2` vs `0.3`, `\sqrt{12}` vs
 * `2\sqrt3`), and for nothing else. Such error is a few ulps — around 1e-16
 * relative — so this sits far above it and still far below any decimal a person
 * would type: a truncation like `0.3333333333` for `1/3` is off by 1e-10 and
 * must be rejected, because writing out digits is not giving the exact answer.
 * Do not loosen this to be generous about rounding; that is a grading policy
 * decision, and it would silently accept wrong answers near the boundary.
 */
const RELATIVE_EPSILON = 1e-12;

type Cursor = { s: string; i: number };

/** A parsed factor, tracking whether it was a bare integer (for mixed numbers). */
type Factor = { value: number; integerLiteral: boolean };

const FAIL = null;

function peek(c: Cursor): string {
    return c.s[c.i] ?? "";
}

/** Consume `lit` if it is next, and (for commands) not a prefix of a longer name. */
function eat(c: Cursor, lit: string): boolean {
    if (!c.s.startsWith(lit, c.i)) return false;
    if (/[a-zA-Z]$/.test(lit)) {
        const after = c.s[c.i + lit.length] ?? "";
        if (/[a-zA-Z]/.test(after)) return false;
    }
    c.i += lit.length;
    return true;
}

/** True when the next char could begin an atom — the implicit-multiply test. */
function startsAtom(c: Cursor): boolean {
    const ch = peek(c);
    return /[0-9.(\\[]/.test(ch);
}

function finite(n: number | null): number | null {
    if (n === null) return FAIL;
    if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) return FAIL;
    return n;
}

/** expr := term (('+' | '-') term)* */
function parseExpr(c: Cursor): number | null {
    let acc = parseTerm(c);
    if (acc === null) return FAIL;
    for (;;) {
        if (eat(c, "+")) {
            const rhs = parseTerm(c);
            if (rhs === null) return FAIL;
            acc += rhs;
        } else if (eat(c, "-")) {
            const rhs = parseTerm(c);
            if (rhs === null) return FAIL;
            acc -= rhs;
        } else {
            return finite(acc);
        }
    }
}

/**
 * term := unary (('*' | '/' | '\cdot' | '\times' | '\div' | juxtaposition) unary)*
 *
 * Juxtaposition is multiplication (`2\pi`) with one exception: an integer
 * literal immediately followed by a fraction is a mixed number, so `2\frac12`
 * is 2.5 and not 1. That is the universal reading in competition answers, and
 * it is why factors carry `integerLiteral`.
 */
function parseTerm(c: Cursor): number | null {
    const first = parseUnary(c);
    if (first === null) return FAIL;
    let acc = first.value;
    let prevWasInteger = first.integerLiteral;

    for (;;) {
        let op: "*" | "/" | "mixed" | null = null;
        if (eat(c, "*") || eat(c, "\\cdot") || eat(c, "\\times")) {
            op = "*";
        } else if (eat(c, "/") || eat(c, "\\div")) {
            op = "/";
        } else if (startsAtom(c)) {
            op = prevWasInteger && c.s.startsWith("\\frac", c.i) ? "mixed" : "*";
        }
        if (op === null) return finite(acc);

        const rhs = parseUnary(c);
        if (rhs === null) return FAIL;
        if (op === "*") acc *= rhs.value;
        else if (op === "mixed") acc += Math.sign(acc || 1) * rhs.value;
        else {
            if (rhs.value === 0) return FAIL;
            acc /= rhs.value;
        }
        prevWasInteger = op === "*" && rhs.integerLiteral;
        if (finite(acc) === null) return FAIL;
    }
}

/** unary := ('+' | '-') unary | power */
function parseUnary(c: Cursor): Factor | null {
    if (eat(c, "-")) {
        const inner = parseUnary(c);
        // A sign doesn't stop `-2\frac12` from being a mixed number, so the
        // integer-literal flag survives negation.
        if (inner === null) return FAIL;
        return { value: -inner.value, integerLiteral: inner.integerLiteral };
    }
    if (eat(c, "+")) return parseUnary(c);
    return parsePower(c);
}

/** power := atom ('^' unary)?  — right-associative, so `2^2^3` is 2^8. */
function parsePower(c: Cursor): Factor | null {
    const base = parseAtom(c);
    if (base === null) return FAIL;
    if (!eat(c, "^")) return base;

    const exponent = parseUnary(c);
    if (exponent === null) return FAIL;
    if (Math.abs(exponent.value) > MAX_EXPONENT) return FAIL;
    const value = Math.pow(base.value, exponent.value);
    return finite(value) === null ? FAIL : { value, integerLiteral: false };
}

/**
 * Parse a LaTeX argument: a braced group, or — as LaTeX itself defines it — a
 * single following token, so `\frac14` is ¼ and not 1/14.
 */
function parseArg(c: Cursor): number | null {
    if (eat(c, "{")) {
        const inner = parseExpr(c);
        if (inner === null || !eat(c, "}")) return FAIL;
        return inner;
    }
    if (/\d/.test(peek(c))) {
        const digit = Number(c.s[c.i]);
        c.i += 1;
        return digit;
    }
    if (eat(c, "\\pi")) return Math.PI;
    return FAIL;
}

function parseAtom(c: Cursor): Factor | null {
    // Grouping. Braces are grouping too: `{1+2}` survives from LaTeX input.
    for (const [open, close] of [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
    ] as const) {
        if (eat(c, open)) {
            const inner = parseExpr(c);
            if (inner === null || !eat(c, close)) return FAIL;
            return { value: inner, integerLiteral: false };
        }
    }

    if (c.s.startsWith("\\frac", c.i)) {
        c.i += "\\frac".length;
        const numerator = parseArg(c);
        if (numerator === null) return FAIL;
        const denominator = parseArg(c);
        if (denominator === null || denominator === 0) return FAIL;
        return { value: numerator / denominator, integerLiteral: false };
    }

    if (c.s.startsWith("\\sqrt", c.i)) {
        c.i += "\\sqrt".length;
        let degree = 2;
        if (eat(c, "[")) {
            const d = parseExpr(c);
            if (d === null || !eat(c, "]") || d === 0) return FAIL;
            degree = d;
        }
        const radicand = parseArg(c);
        if (radicand === null) return FAIL;
        // Odd roots of negatives are real, but `Math.pow` returns NaN for them.
        const root =
            radicand < 0
                ? Number.isInteger(degree) && degree % 2 !== 0
                    ? -Math.pow(-radicand, 1 / degree)
                    : NaN
                : Math.pow(radicand, 1 / degree);
        return finite(root) === null ? FAIL : { value: root, integerLiteral: false };
    }

    if (eat(c, "\\pi")) return { value: Math.PI, integerLiteral: false };

    // A number literal. Exponent notation is deliberately excluded: `2e3` is far
    // more often a product with a variable than scientific notation.
    const match = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(c.s.slice(c.i));
    if (match) {
        c.i += match[0].length;
        const value = Number(match[0]);
        if (!Number.isFinite(value)) return FAIL;
        return { value, integerLiteral: Number.isInteger(value) && !match[0].includes(".") };
    }

    return FAIL;
}

/**
 * Strip the cosmetic LaTeX that carries no arithmetic, so the parser only ever
 * sees structure. Anything not removed here and not in the grammar fails the
 * evaluation, which is the intended conservative outcome.
 */
function prepare(raw: string): string {
    return raw
        .replace(/\\left(?![a-zA-Z])/g, "")
        .replace(/\\right(?![a-zA-Z])/g, "")
        .replace(/\\displaystyle(?![a-zA-Z])/g, "")
        .replace(/\\(?:dfrac|tfrac)(?![a-zA-Z])/g, "\\frac")
        .replace(/\\(?:qquad|quad)(?![a-zA-Z])/g, "")
        .replace(/\\[!,;: ]/g, "")
        .replace(/[−‒–—]/g, "-")
        .replace(/\s+/g, "")
        // Thousands separators only. Any other comma is left in place so it
        // fails the parse, because a comma is also how tuples and sets are
        // written and `(1,2)` must never be evaluated as the number 12.
        .replace(/(?<=\d),(?=\d{3}(?!\d))/g, "");
}

/**
 * The numeric value `raw` denotes, or `null` when it isn't a closed arithmetic
 * expression. `null` means "cannot say", never "not a number" — callers must
 * treat it as no-opinion rather than as a mismatch.
 */
export function evaluateNumeric(raw: string): number | null {
    const s = prepare(raw);
    if (!s) return FAIL;
    const c: Cursor = { s, i: 0 };
    const value = parseExpr(c);
    // A trailing remainder means the grammar didn't cover the whole answer
    // (`5cm`, `2x`, `1,2`), so the value would describe only part of it.
    if (value === null || c.i !== s.length) return FAIL;
    return value;
}

/** True when both strings denote the same number, within float tolerance. */
export function numericallyEqual(a: string, b: string): boolean {
    const va = evaluateNumeric(a);
    const vb = evaluateNumeric(b);
    if (va === null || vb === null) return false;
    if (va === vb) return true;
    const scale = Math.max(Math.abs(va), Math.abs(vb));
    return Math.abs(va - vb) <= RELATIVE_EPSILON * scale;
}
