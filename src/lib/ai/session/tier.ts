/**
 * Conversation tiers (docs/ai-coach-sessions.md §1).
 *
 * A tier is decided by *where the Coach was summoned and whether it was escalated*,
 * never by a user-facing toggle. Kept as a pure module — no runes, no fetch — so the
 * rule that decides whether a thread exists in the database at all is unit-testable
 * on its own.
 */

/**
 * - `one-shot` — a quick-ask that was never escalated. Held in memory only; **no
 *   database row is ever created for it.**
 * - `assist` — the panel. Persisted, but never auto-resumed: each open starts a new
 *   thread and history is one click away.
 * - `work` — coaching anchored to a problem (the trainer's inline presentation).
 *   Persisted, and from Phase 2 resumable by anchor.
 */
export type CoachTier = "one-shot" | "assist" | "work";

/** Where the Coach is currently being shown. Presentation decides tier, not the user. */
export type CoachPresentation = "quick-ask" | "panel" | "inline";

const PRESENTATION_TIER: Record<CoachPresentation, CoachTier> = {
    "quick-ask": "one-shot",
    panel: "assist",
    inline: "work",
};

export function tierForPresentation(presentation: CoachPresentation): CoachTier {
    return PRESENTATION_TIER[presentation];
}

/** Whether a thread of this tier has a database row. The one-shot's defining property. */
export function tierPersists(tier: CoachTier): boolean {
    return tier !== "one-shot";
}

/**
 * The tier a thread takes when it is escalated into `target`.
 *
 * Promotion only ever leaves `one-shot`: once a thread is persisted its tier is
 * settled. In particular there is **no assist → work promotion** (decided
 * 2026-08-05) — starting practice from an assist thread opens a *new* work thread
 * for the problem and leaves the assist thread alone — and nothing demotes a
 * persisted thread back to memory, which would orphan the rows it already wrote.
 */
export function promoteTier(current: CoachTier, target: CoachTier): CoachTier {
    if (tierPersists(current)) return current;
    return target;
}
