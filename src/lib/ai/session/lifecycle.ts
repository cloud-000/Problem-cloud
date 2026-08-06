/**
 * Work-thread lifecycle (docs/ai-coach-sessions.md §5).
 *
 * Deliberately a pure, isolated module: the rule is expected to change. Everything
 * that decides whether a thread is offered back to the user, or released from its
 * anchor, lives here and nowhere else.
 */

/** What the trainer knows about the anchor the thread was opened for. */
export interface WorkAnchorState {
    /** A graded submission was written for this sitting. */
    submitted: boolean;
    /** The student explicitly skipped the problem — also a `submissions` row. */
    skipped: boolean;
    /** The student has moved off the anchor (another problem, or left the trainer). */
    leftAnchor: boolean;
    /** `now - last_active_at`, in milliseconds. */
    idleMs: number;
}

/** How long an unconcluded thread stays offerable. Tuning knob, not a rule. */
export const WORK_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Has the work this thread was opened for concluded?
 *
 * Two things read this: when the row releases its anchor slot (`workRetirable`), and how
 * the resume prompt is worded — returning to a finished sitting is a *review* of what you
 * struggled with, not a continuation of work in progress.
 *
 * A skip counts, and not only for symmetry: it writes a real `submissions` row and is
 * an explicit "I'm done with this". Left out, a skipped problem's thread would stay
 * live and hold its unique-index slot until staleness or a return visit cleared it.
 *
 * `revealed` deliberately has no say here — showing the answer is a *solution-access*
 * gate (§6's `get_solution`), not the end of the sitting; a student who reveals and
 * then asks "why?" is exactly who this thread is for.
 */
export function workConcluded(state: WorkAnchorState): boolean {
    return state.submitted || state.skipped;
}

/**
 * May the thread be offered back if the user returns to the anchor? Drives the prompt.
 *
 * **Conclusion deliberately has no say (revised 2026-08-06).** It used to suppress the
 * offer, on the reasoning that a finished sitting starts clean — but the chat about a
 * problem you just got wrong is the one you most want back, and "what was I struggling
 * with here?" is the whole reason the thread was worth keeping. A concluded thread is
 * offered exactly like an unconcluded one; only the prompt's wording differs, which is
 * what `workConcluded` now decides.
 *
 * Staleness is therefore the only rule left, and it is the one that matters: the root
 * practice session never ends, so without a cutoff the trainer would ask "continue or
 * start new?" over a week-old conversation the student has entirely forgotten.
 */
export function workResumable(state: WorkAnchorState): boolean {
    return state.idleMs < WORK_STALE_AFTER_MS;
}

/**
 * When the row releases its anchor slot. Retired ≠ deleted: it stays in history, and it
 * is still offered back on a return visit — retiring only means it is no longer the
 * *live* thread for this anchor, so the next sitting is free to start its own.
 *
 * Concluded ≠ retired, on purpose: submitting a wrong answer is the moment a student
 * most wants to ask "why?", so the thread stays live and writable while they remain on
 * the problem, and is retired only once they move on.
 */
export function workRetirable(state: WorkAnchorState): boolean {
    return workConcluded(state) && state.leftAnchor;
}
