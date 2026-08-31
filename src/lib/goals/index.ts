/**
 * Goals — the domain layer. See `docs/goals.md` (what a goal is) and
 * `docs/goal-target-architecture.md` (how a new target type is added).
 *
 * Layering, which is the thing to preserve: `types` and `period` are data,
 * `registry` and `plan` are pure functions over it, and `data` is the only
 * module that knows Supabase exists.
 */

export * from "./types";
export * from "./period";
export * from "./registry";
export * from "./plan";
export * from "./data";
export * from "./promote";
