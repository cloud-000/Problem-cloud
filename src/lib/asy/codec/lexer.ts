/**
 * Lexer for the Asymptote subset. Char scanner -> tokens. Every token carries
 * source `start`/`end` offsets so the parser can capture the exact original
 * text of unrecognized statements for raw passthrough.
 *
 * Whitespace and comments (`// ...`, `/* ... *\/`) are skipped. Anything the
 * subset doesn't specifically recognize becomes an `"other"` token so scanning
 * still reaches the next `;`.
 */

import type { Token, TokenKind } from "./tokens";

function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentPart(c: string): boolean {
    return isIdentStart(c) || isDigit(c);
}

export function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = src.length;

    const push = (kind: TokenKind, start: number, end: number) => {
        tokens.push({ kind, value: src.slice(start, end), start, end });
    };

    while (i < n) {
        const c = src[i];

        // Whitespace
        if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\v") {
            i++;
            continue;
        }

        // Comments
        if (c === "/" && src[i + 1] === "/") {
            i += 2;
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
            i += 2; // consume the closing */ (harmless if it runs past EOF)
            continue;
        }

        // Joins: -- and ..  (checked before number so `..` isn't eaten as decimals)
        if (c === "-" && src[i + 1] === "-") {
            push("join", i, i + 2);
            i += 2;
            continue;
        }
        if (c === "." && src[i + 1] === ".") {
            push("join", i, i + 2);
            i += 2;
            continue;
        }

        // Numbers: [-]? ( digits [.digits]? | .digits ) ( [eE][+-]?digits )?
        // A leading `-` counts only when immediately followed by a digit or `.digit`
        // (a lone `-` becomes `other`; `--` was handled above).
        if (
            isDigit(c) ||
            (c === "." && isDigit(src[i + 1])) ||
            (c === "-" && (isDigit(src[i + 1]) || (src[i + 1] === "." && isDigit(src[i + 2]))))
        ) {
            const start = i;
            if (src[i] === "-") i++;
            while (i < n && isDigit(src[i])) i++;
            if (src[i] === ".") {
                i++;
                while (i < n && isDigit(src[i])) i++;
            }
            if (src[i] === "e" || src[i] === "E") {
                let j = i + 1;
                if (src[j] === "+" || src[j] === "-") j++;
                if (isDigit(src[j])) {
                    i = j;
                    while (i < n && isDigit(src[i])) i++;
                }
            }
            push("number", start, i);
            continue;
        }

        // Identifiers / keywords
        if (isIdentStart(c)) {
            const start = i;
            i++;
            while (i < n && isIdentPart(src[i])) i++;
            push("ident", start, i);
            continue;
        }

        // String literal "..." with backslash escapes
        if (c === '"') {
            const start = i;
            i++;
            while (i < n && src[i] !== '"') {
                if (src[i] === "\\") i++; // skip escaped char
                i++;
            }
            i++; // closing quote (harmless past EOF)
            push("string", start, i);
            continue;
        }

        if (c === "*") {
            push("star", i, i + 1);
            i++;
            continue;
        }

        // Single-character tokens
        switch (c) {
            case "(":
                push("lparen", i, i + 1);
                i++;
                continue;
            case ")":
                push("rparen", i, i + 1);
                i++;
                continue;
            case ",":
                push("comma", i, i + 1);
                i++;
                continue;
            case ";":
                push("semi", i, i + 1);
                i++;
                continue;
            case "=":
                push("equals", i, i + 1);
                i++;
                continue;
            case "+":
                push("plus", i, i + 1);
                i++;
                continue;
            default:
                push("other", i, i + 1);
                i++;
                continue;
        }
    }

    tokens.push({ kind: "eof", value: "", start: n, end: n });
    return tokens;
}

/** Decode an asy string-literal token value (with surrounding quotes) to text. */
export function decodeString(raw: string): string {
    // Strip surrounding quotes if present.
    let s = raw;
    if (s.startsWith('"')) s = s.slice(1);
    if (s.endsWith('"')) s = s.slice(0, -1);
    return s.replace(/\\(.)/g, "$1");
}
