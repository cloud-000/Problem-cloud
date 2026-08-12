import { describe, expect, test } from "bun:test";
import { answersMatch, normalizeAnswer } from "./answer-matcher";

/** Matching is a symmetric relation; nothing may depend on argument order. */
function matches(a: string, b: string): boolean {
    const forward = answersMatch(a, b);
    expect(answersMatch(b, a)).toBe(forward);
    return forward;
}

describe("normalizeAnswer", () => {
    test("is idempotent", () => {
        for (const input of [
            "\\dfrac{1}{6}",
            "$1{,}000$",
            "2\\frac{1}{2}",
            "𝜋",
            "\\text{none}",
            "\\left(1+2\\right)",
        ]) {
            const once = normalizeAnswer(input);
            expect(normalizeAnswer(once)).toBe(once);
        }
    });

    test("preserves command case, folds everything else", () => {
        // `\pi` and `\Pi` are different symbols; `ABC` and `abc` are not.
        expect(normalizeAnswer("\\Pi")).toBe("\\Pi");
        expect(normalizeAnswer("ABC")).toBe("abc");
    });

    test("canonicalizes Unicode pi glyphs to LaTeX", () => {
        expect(normalizeAnswer("π")).toBe("\\pi");
        expect(normalizeAnswer("𝜋")).toBe("\\pi");
        expect(normalizeAnswer("Π")).toBe("\\Pi");
    });

    test("a whole number before a fraction is read as a mixed number", () => {
        expect(normalizeAnswer("2\\frac{1}{2}")).toBe("2+1/2");
        // Juxtaposition that isn't a mixed number keeps its old reading.
        expect(normalizeAnswer("x\\frac{1}{2}")).toBe("x1/2");
    });
});

describe("equivalent spellings of the same answer", () => {
    test("fractions", () => {
        expect(matches("1/6", "\\frac{1}{6}")).toBe(true);
        expect(matches("1/6", "\\dfrac16")).toBe(true);
        expect(matches("1/6", "\\tfrac{1}{6}")).toBe(true);
        expect(matches("\\frac{1}{6}", "$\\frac16$")).toBe(true);
        expect(matches("-\\frac{1}{2}", "\\frac{-1}{2}")).toBe(true);
    });

    test("math-mode wrappers and sizing commands", () => {
        expect(matches("$5$", "5")).toBe(true);
        expect(matches("\\(5\\)", "5")).toBe(true);
        expect(matches("\\[5\\]", "5")).toBe(true);
        expect(matches("\\left(1+2\\right)", "(1+2)")).toBe(true);
        expect(matches("2\\pi", "2 \\pi")).toBe(true);
    });

    test("Unicode and LaTeX pi spellings", () => {
        expect(matches("π", "\\pi")).toBe(true);
        expect(matches("𝜋", "\\pi")).toBe(true);
        expect(matches("2π", "2\\pi")).toBe(true);
        expect(matches("π/2", "\\frac{\\pi}{2}")).toBe(true);
        expect(matches("π radians", "\\pi")).toBe(true);
    });

    test("text-mode wrappers", () => {
        expect(matches("\\text{none}", "none")).toBe(true);
        expect(matches("\\mathrm{ABC}", "abc")).toBe(true);
    });

    test("minus signs from any keyboard or renderer", () => {
        expect(matches("−5", "-5")).toBe(true); // U+2212
        expect(matches("–5", "-5")).toBe(true); // en dash
    });

    test("sets written with escaped braces", () => {
        expect(matches("\\{1,2\\}", "{1,2}")).toBe(true);
    });

    test("a restated variable assignment", () => {
        expect(matches("x = 5", "5")).toBe(true);
        expect(matches("n=12", "12")).toBe(true);
        expect(matches("y=2x+1", "2x+1")).toBe(true);
    });
});

describe("units, labels and decoration", () => {
    test("trailing unit words", () => {
        expect(matches("8 pies", "8")).toBe(true);
        expect(matches("19 cm", "19")).toBe(true);
        expect(matches("12 square meters", "12")).toBe(true);
        expect(matches("\\frac{1}{4} square meters", "\\frac14")).toBe(true);
    });

    test("currency, percent and degrees", () => {
        expect(matches("$5", "5")).toBe(true);
        expect(matches("5%", "5")).toBe(true);
        expect(matches("90°", "90")).toBe(true);
        expect(matches("90 degrees", "90")).toBe(true);
    });

    test("parenthesized labels and approximation words", () => {
        expect(matches("900 (pieces)", "900")).toBe(true);
        expect(matches("about 7", "7")).toBe(true);
    });

    test("numeric formatting", () => {
        expect(matches("1,000,000", "1000000")).toBe(true);
        expect(matches(".5", "0.5")).toBe(true);
        expect(matches("007", "7")).toBe(true);
        expect(matches("+5", "5")).toBe(true);
    });
});

describe("same value, different form", () => {
    // The value tier. These are not lexically equal by any normalization.
    test("fraction against decimal", () => {
        expect(matches("1/2", "0.5")).toBe(true);
        expect(matches("1.50", "3/2")).toBe(true);
    });

    test("unreduced fractions", () => {
        expect(matches("\\frac{2}{4}", "\\frac{1}{2}")).toBe(true);
        expect(matches("6/8", "3/4")).toBe(true);
    });

    test("evaluated arithmetic", () => {
        expect(matches("2^3", "8")).toBe(true);
        expect(matches("\\sqrt{4}", "2")).toBe(true);
        expect(matches("2+3", "5")).toBe(true);
    });

    test("mixed numbers", () => {
        expect(matches("2\\frac{1}{2}", "5/2")).toBe(true);
        expect(matches("2\\frac{1}{2}", "2.5")).toBe(true);
    });
});

describe("compound symbolic expressions", () => {
    // Nothing here is evaluatable, so these are the lexical layer alone. It
    // survives them because `\frac` → slash conversion parenthesizes an
    // argument exactly when it contains an operator, which preserves structure
    // rather than merely deleting the command.

    test("a fraction of full expressions", () => {
        expect(
            matches("\\frac{1 + x^{y} + z}{3x^2 + 54}", "(1 + x^y + z)/(3x^2 + 54)"),
        ).toBe(true);
        expect(matches("\\frac{a+b}{c}", "(a+b)/c")).toBe(true);
        expect(matches("\\frac{a}{b+c}", "a/(b+c)")).toBe(true);
        expect(matches("\\dfrac{x^{2}+1}{x-1}", "(x^2+1)/(x-1)")).toBe(true);
    });

    test("nested fractions", () => {
        expect(matches("\\frac{\\frac{1}{2}}{3}", "(1/2)/3")).toBe(true);
        expect(matches("\\frac{\\frac{a}{b}}{c}", "(a/b)/c")).toBe(true);
        expect(matches("\\frac{1}{\\frac{1}{2}}", "1/(1/2)")).toBe(true);
        // And the numeric layer still reaches through the nesting.
        expect(matches("\\frac{\\frac{1}{2}}{3}", "1/6")).toBe(true);
    });

    test("braced exponents and radicands", () => {
        expect(matches("x^{2}", "x^2")).toBe(true);
        expect(matches("\\frac{1}{x^{2}}", "1/x^2")).toBe(true);
        expect(matches("\\frac{\\sqrt{a}}{2}", "\\sqrt{a}/2")).toBe(true);
    });

    test("a leading minus is grouped in a denominator but not a numerator", () => {
        expect(matches("\\frac{-a}{b}", "-a/b")).toBe(true);
        // `a/-b` would be ambiguous, so the denominator keeps its parentheses.
        expect(matches("\\frac{a}{-b}", "a/(-b)")).toBe(true);
    });

    test("symbolic answers that happen to be numerically equal", () => {
        expect(matches("2\\sqrt{3}", "\\sqrt{12}")).toBe(true);
        expect(matches("\\frac{\\pi}{2}", "\\frac{1}{2}\\pi")).toBe(true);
        expect(matches("2^{-2}", "1/4")).toBe(true);
        expect(matches("(2+3)^2", "25")).toBe(true);
        expect(matches("\\sqrt{\\frac{1}{4}}", "1/2")).toBe(true);
    });

    test("multi-part answers keep their separators", () => {
        expect(matches("(1,2)", "(1, 2)")).toBe(true);
        expect(matches("x=1,y=2", "x=1, y=2")).toBe(true);
        expect(matches("1+i", "1 + i")).toBe(true);
    });
});

describe("what must stay wrong", () => {
    test("regrouping changes the answer", () => {
        // The parenthesization above is load-bearing: without it every one of
        // these would collapse to its counterpart once `\frac` was dropped.
        expect(matches("\\frac{a}{b+c}", "a/b+c")).toBe(false);
        expect(matches("\\frac{a+b}{c}", "a+b/c")).toBe(false);
        expect(matches("x^{y+1}", "x^y+1")).toBe(false);
        expect(matches("\\frac{1}{2}+3", "\\frac{1}{2+3}")).toBe(false);
    });

    test("operands are not interchangeable", () => {
        expect(matches("\\frac{x}{y}", "\\frac{y}{x}")).toBe(false);
        expect(matches("(1+x)/2", "(1-x)/2")).toBe(false);
        expect(matches("\\sqrt{12}", "\\sqrt{3}")).toBe(false);
        expect(matches("{1,2}", "{2,1}")).toBe(false);
    });

    // A false positive here credits a wrong answer, which is the one failure
    // mode this module must not have. Every case is deliberate.

    test("different numbers", () => {
        expect(matches("5", "6")).toBe(false);
        expect(matches("1/2", "2/1")).toBe(false);
        expect(matches("-5", "5")).toBe(false);
    });

    test("a decimal approximation is not the exact value", () => {
        expect(matches("3.14", "\\pi")).toBe(false);
        expect(matches("0.33", "1/3")).toBe(false);
        // Ten digits of 1/3 is still an approximation: the tolerance covers
        // float noise, not rounding.
        expect(matches("0.3333333333", "1/3")).toBe(false);
        // The limit of that claim, stated honestly: a decimal transcribed to
        // the full precision of a double is within a few ulps of the exact
        // value, so no float comparison can tell it from a computed one. Only
        // exact equality could, and that would fail `0.1+0.2` against `0.3`.
        expect(matches("3.14159265358979", "\\pi")).toBe(true);
    });

    test("no symbolic algebra is claimed", () => {
        expect(matches("\\frac{a}{b}", "\\frac{b}{a}")).toBe(false);
        expect(matches("2x", "x+x")).toBe(false);
        expect(matches("x", "y")).toBe(false);
    });

    test("a tuple is not the number its digits spell", () => {
        // `(1,2)` must never evaluate as 12 by dropping the comma.
        expect(matches("(1,2)", "12")).toBe(false);
        expect(matches("\\{1,2\\}", "12")).toBe(false);
    });

    test("a mixed number is not the fraction its digits spell", () => {
        expect(matches("2\\frac{1}{2}", "\\frac{21}{2}")).toBe(false);
    });

    test("two different assignments are not the same answer", () => {
        // Naming the value is ignorable, so `y=2x+1` does match `2x+1` — but
        // only one side may shed its prefix, or these would collapse together.
        expect(matches("y=2x+1", "z=2x+1")).toBe(false);
        expect(matches("x=5", "n=5")).toBe(false);
    });

    test("case matters for command names", () => {
        expect(matches("\\pi", "\\Pi")).toBe(false);
        expect(matches("π", "Π")).toBe(false);
        expect(matches("Π", "\\Pi")).toBe(true);
    });

    test("an empty answer matches nothing but itself", () => {
        expect(matches("", "5")).toBe(false);
    });
});
