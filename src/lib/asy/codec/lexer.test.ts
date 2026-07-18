import { describe, expect, test } from "bun:test";
import { decodeString, tokenize } from "./lexer";
import type { TokenKind } from "./tokens";

function kinds(src: string): TokenKind[] {
    return tokenize(src).map((t) => t.kind);
}

function values(src: string): string[] {
    return tokenize(src)
        .filter((t) => t.kind !== "eof")
        .map((t) => t.value);
}

describe("tokenize", () => {
    test("always ends with eof", () => {
        expect(tokenize("").map((t) => t.kind)).toEqual(["eof"]);
    });

    test("a simple draw statement", () => {
        expect(kinds("draw((0,0)--(1,1));")).toEqual([
            "ident",
            "lparen",
            "lparen",
            "number",
            "comma",
            "number",
            "rparen",
            "join",
            "lparen",
            "number",
            "comma",
            "number",
            "rparen",
            "rparen",
            "semi",
            "eof",
        ]);
    });

    test("distinguishes -- join from negative numbers", () => {
        expect(values("(0,0)--(-1,-2)")).toEqual([
            "(",
            "0",
            ",",
            "0",
            ")",
            "--",
            "(",
            "-1",
            ",",
            "-2",
            ")",
        ]);
    });

    test("distinguishes .. join from decimals", () => {
        expect(values("(0,0)..(1.5,2.25)")).toEqual([
            "(",
            "0",
            ",",
            "0",
            ")",
            "..",
            "(",
            "1.5",
            ",",
            "2.25",
            ")",
        ]);
    });

    test("leading-dot decimals and scientific notation", () => {
        expect(values(".5 1e3 2.5E-2")).toEqual([".5", "1e3", "2.5E-2"]);
    });

    test("skips line and block comments", () => {
        expect(values("dot((0,0)); // a comment\n/* block */ dot((1,1));")).toEqual([
            "dot",
            "(",
            "(",
            "0",
            ",",
            "0",
            ")",
            ")",
            ";",
            "dot",
            "(",
            "(",
            "1",
            ",",
            "1",
            ")",
            ")",
            ";",
        ]);
    });

    test("string literals with escapes", () => {
        const toks = tokenize('label("$A\\"$", (0,0));');
        const str = toks.find((t) => t.kind === "string")!;
        expect(str.value).toBe('"$A\\"$"');
        expect(decodeString(str.value)).toBe('$A"$');
    });

    test("unknown chars become 'other' so scanning reaches ;", () => {
        expect(kinds("x = a*b;")).toEqual([
            "ident",
            "equals",
            "ident",
            "other", // *
            "ident",
            "semi",
            "eof",
        ]);
    });

    test("token offsets map back to source", () => {
        const toks = tokenize("dot((1,2));");
        const ident = toks[0];
        expect("dot((1,2));".slice(ident.start, ident.end)).toBe("dot");
    });
});
