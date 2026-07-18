/**
 * The Asymptote codec: Scene <-> asy source.
 *
 *   serialize(scene) -> string   (deterministic pretty-printer)
 *   parse(asy)       -> { scene, diagnostics }
 */

export { serialize, type SerializeOptions } from "./serialize";
export { parse, type ParseResult } from "./parse";
export type { Diagnostic } from "./lower";
