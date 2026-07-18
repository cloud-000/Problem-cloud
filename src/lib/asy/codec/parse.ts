/**
 * Public entry for Asymptote -> Scene. Orchestrates tokenize -> parse -> lower.
 */

import type { Scene } from "../scene/types";
import { parseProgram } from "./parser";
import { lower, type Diagnostic } from "./lower";

export interface ParseResult {
    scene: Scene;
    /** Non-fatal notes: which spans fell back to `raw` and why. */
    diagnostics: Diagnostic[];
}

export function parse(asy: string): ParseResult {
    const stmts = parseProgram(asy);
    const { elements, diagnostics } = lower(stmts, asy);
    return { scene: { elements, meta: { source: "import" } }, diagnostics };
}
