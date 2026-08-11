import { describe, expect, test } from "bun:test";
import { evaluateNumeric, numericallyEqual } from "./answer-value";

describe("arithmetic", () => {
    test("plain numbers", () => {
        expect(evaluateNumeric("7")).toBe(7);
        expect(evaluateNumeric("007")).toBe(7);
        expect(evaluateNumeric("1.50")).toBe(1.5);
        expect(evaluateNumeric("-5")).toBe(-5);
        expect(evaluateNumeric("+5")).toBe(5);
    });

    test("the four operations, with precedence", () => {
        expect(evaluateNumeric("2+3*4")).toBe(14);
        expect(evaluateNumeric("(2+3)*4")).toBe(20);
        expect(evaluateNumeric("10-2-3")).toBe(5);
        expect(evaluateNumeric("100/10/2")).toBe(5);
    });

    test("exponentiation is right-associative", () => {
        expect(evaluateNumeric("2^3")).toBe(8);
        expect(evaluateNumeric("2^{10}")).toBe(1024);
        expect(evaluateNumeric("2^2^3")).toBe(256);
        expect(evaluateNumeric("2^{-1}")).toBe(0.5);
    });

    test("fractions, braced or not", () => {
        expect(evaluateNumeric("\\frac{1}{4}")).toBe(0.25);
        expect(evaluateNumeric("\\frac14")).toBe(0.25);
        expect(evaluateNumeric("\\dfrac{1}{4}")).toBe(0.25);
        expect(evaluateNumeric("\\frac{1+2}{6}")).toBe(0.5);
    });

    test("roots", () => {
        expect(evaluateNumeric("\\sqrt{4}")).toBe(2);
        expect(evaluateNumeric("\\sqrt9")).toBe(3);
        expect(evaluateNumeric("\\sqrt[3]{27}")).toBeCloseTo(3, 12);
        // Odd roots of negatives are real even though Math.pow says NaN.
        expect(evaluateNumeric("\\sqrt[3]{-8}")).toBeCloseTo(-2, 12);
        expect(evaluateNumeric("\\sqrt{-4}")).toBeNull();
    });

    test("juxtaposition multiplies", () => {
        expect(evaluateNumeric("2\\pi")).toBeCloseTo(2 * Math.PI, 12);
        expect(evaluateNumeric("2(3)")).toBe(6);
        expect(evaluateNumeric("\\pi")).toBe(Math.PI);
    });

    test("an integer before a fraction is a mixed number, not a product", () => {
        expect(evaluateNumeric("2\\frac{1}{2}")).toBe(2.5);
        expect(evaluateNumeric("-2\\frac{1}{2}")).toBe(-2.5);
        expect(evaluateNumeric("2+1/2")).toBe(2.5);
    });

    test("cosmetic LaTeX and unicode minus signs are ignored", () => {
        expect(evaluateNumeric("\\left(2+3\\right)")).toBe(5);
        expect(evaluateNumeric("\\displaystyle\\frac{1}{2}")).toBe(0.5);
        expect(evaluateNumeric("−5")).toBe(-5);
        expect(evaluateNumeric("–5")).toBe(-5);
        expect(evaluateNumeric(" 1 + 2 ")).toBe(3);
    });

    test("thousands separators, but only real ones", () => {
        expect(evaluateNumeric("1,000")).toBe(1000);
        expect(evaluateNumeric("1,000,000")).toBe(1000000);
        expect(evaluateNumeric("1,0000")).toBeNull();
    });
});

describe("refusing to guess", () => {
    // Every case here must be null, not a number: a wrong value grades a wrong
    // answer as correct, while null just falls back to lexical comparison.

    test("anything symbolic", () => {
        expect(evaluateNumeric("x")).toBeNull();
        expect(evaluateNumeric("2x")).toBeNull();
        expect(evaluateNumeric("\\frac{a}{b}")).toBeNull();
        expect(evaluateNumeric("n+1")).toBeNull();
    });

    test("unknown commands and functions", () => {
        expect(evaluateNumeric("\\sin{0}")).toBeNull();
        expect(evaluateNumeric("\\log_2 8")).toBeNull();
        expect(evaluateNumeric("5!")).toBeNull();
    });

    test("tuples, sets and intervals are never collapsed to a number", () => {
        expect(evaluateNumeric("(1,2)")).toBeNull();
        expect(evaluateNumeric("\\{1,2\\}")).toBeNull();
        expect(evaluateNumeric("[0,1]")).toBeNull();
    });

    test("a trailing remainder fails the whole evaluation", () => {
        expect(evaluateNumeric("5cm")).toBeNull();
        expect(evaluateNumeric("5 apples")).toBeNull();
        expect(evaluateNumeric("")).toBeNull();
    });

    test("division by zero and unbalanced groups", () => {
        expect(evaluateNumeric("1/0")).toBeNull();
        expect(evaluateNumeric("\\frac{1}{0}")).toBeNull();
        expect(evaluateNumeric("(1+2")).toBeNull();
        expect(evaluateNumeric("\\frac{1}{2")).toBeNull();
    });

    test("magnitudes that cannot be compared as floats", () => {
        expect(evaluateNumeric("9^{9^9}")).toBeNull();
        expect(evaluateNumeric("10^{20}")).toBeNull();
    });

    test("scientific notation is not assumed", () => {
        // `2e3` is far more often "2 times e cubed" or a typo than 2000.
        expect(evaluateNumeric("2e3")).toBeNull();
    });
});

describe("numericallyEqual", () => {
    test("same value, different spelling", () => {
        expect(numericallyEqual("1/2", "0.5")).toBe(true);
        expect(numericallyEqual("\\frac{2}{4}", "\\frac{1}{2}")).toBe(true);
        expect(numericallyEqual("1.50", "3/2")).toBe(true);
        expect(numericallyEqual("2^3", "8")).toBe(true);
    });

    test("float noise is absorbed, rounding is not", () => {
        expect(numericallyEqual("0.1+0.2", "0.3")).toBe(true);
        // Same value reached by different arithmetic, so a few ulps apart.
        expect(numericallyEqual("2\\sqrt{3}", "\\sqrt{12}")).toBe(true);
        expect(numericallyEqual("\\sqrt[3]{27}", "3")).toBe(true);
        expect(numericallyEqual("\\pi", "3.14")).toBe(false);
        expect(numericallyEqual("1/3", "0.33")).toBe(false);
        expect(numericallyEqual("1/3", "0.3333333333")).toBe(false);
    });

    test("nesting", () => {
        expect(numericallyEqual("\\frac{\\frac{1}{2}}{3}", "1/6")).toBe(true);
        expect(numericallyEqual("\\sqrt{\\frac{1}{4}}", "1/2")).toBe(true);
        expect(numericallyEqual("\\frac{\\pi}{2}", "\\frac{1}{2}\\pi")).toBe(true);
        expect(numericallyEqual("(2+3)^2", "25")).toBe(true);
    });

    test("no opinion on either side is not a match", () => {
        expect(numericallyEqual("x", "x")).toBe(false);
        expect(numericallyEqual("5", "x")).toBe(false);
    });

    test("different values stay different", () => {
        expect(numericallyEqual("1/2", "2/1")).toBe(false);
        expect(numericallyEqual("5", "6")).toBe(false);
    });
});
