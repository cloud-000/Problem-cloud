/** Token kinds for the Asymptote subset lexer. */
export type TokenKind =
    | "number"
    | "ident"
    | "string"
    | "lparen"
    | "rparen"
    | "comma"
    | "semi"
    | "equals"
    | "plus"
    | "star"
    | "join" // `--` or `..`
    /** Any character the subset lexer doesn't specifically handle (e.g. `*`, `/`,
     *  `{`, `[`, a lone `-`). Lets the parser scan through unknown statements to
     *  the terminating `;` and capture them as raw. */
    | "other"
    | "eof";

export interface Token {
    kind: TokenKind;
    /** Raw text of the token (for `join`, either "--" or ".."). */
    value: string;
    /** Source offset of the first character (inclusive). */
    start: number;
    /** Source offset one past the last character (exclusive). */
    end: number;
}
