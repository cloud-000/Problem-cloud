/**
 * Work-thread anchors (docs/ai-coach-sessions.md §4).
 *
 * An anchor answers "which sitting is this thread about". It is deliberately a
 * *pre-hoc approximation of an encounter*: the trainer writes its one `submissions`
 * row at the end of a sitting, so nothing attempt-shaped exists when the thread opens.
 * `(problemId, practiceSessionId)` is the best key available up front.
 *
 * Pure module — no runes, no fetch — so the rule that decides which thread a surface
 * attaches to is unit-testable on its own.
 */

export interface WorkAnchor {
    /**
     * The **canonical** problem id (`coalesce(canonical_id, id)`), for the same reason
     * submissions canonicalize: an alias placement must not fork the thread.
     */
    problemId: number;
    /**
     * Which sitting. Null only for library work — practice always has a session, since
     * every user has an always-present root one. Null is a *single* slot rather than
     * unlimited ones, because the unique index is `nulls not distinct` (§2).
     */
    practiceSessionId: number | null;
}

/**
 * The anchor for a problem row, resolving an alias to the canonical it shares state
 * with. Mirrors `coalesce(canonical_id, id)`, which is what the database indexes on.
 */
export function anchorFor(
    problem: { id: number; canonical_id?: number | null },
    practiceSessionId: number | null,
): WorkAnchor {
    return { problemId: problem.canonical_id ?? problem.id, practiceSessionId };
}

/** Whether two anchors address the same sitting. Null session ids compare equal. */
export function sameAnchor(a: WorkAnchor | null, b: WorkAnchor | null): boolean {
    if (!a || !b) return a === b;
    return a.problemId === b.problemId && a.practiceSessionId === b.practiceSessionId;
}

/** Stable string form, for map keys and query parameters. */
export function anchorKey(anchor: WorkAnchor): string {
    return `${anchor.problemId}:${anchor.practiceSessionId ?? ""}`;
}
