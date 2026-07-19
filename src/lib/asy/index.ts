/**
 * The `asy` library: a framework-agnostic core for the whiteboard feature.
 *
 *   scene/  — the Scene IR (document model + asy interchange format)
 *   codec/  — parse (asy -> Scene) and serialize (Scene -> asy)
 *   engine/ — geometry, hit-testing, freehand simplify, undo/redo, and tools
 *
 * Pure TypeScript, ZERO Svelte / `$lib` imports, so it stays independently
 * `bun test`-able and extractable to a standalone package later.
 */

export * from "./scene";
export * from "./codec";
export * from "./engine";
export * from "./editor-properties";
