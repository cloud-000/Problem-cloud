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
 * May the thread be resumed if the user returns to the anchor? Drives the prompt.
 *
 * The staleness cutoff is what stops an abandoned thread from being offered forever:
 * a thread that never concludes has nothing else to retire it, and the root practice
 * session never ends, so without it the trainer would ask "continue or start new?"
 * over a week-old conversation the user has entirely forgotten.
 */
export function workResumable(state: WorkAnchorState): boolean {
    return !workConcluded(state) && state.idleMs < WORK_STALE_AFTER_MS;
}

/**
 * When the row is actually archived, freeing the unique-index slot.
 *
 * Concluded ≠ archived, on purpose: submitting a wrong answer is the moment a student
 * most wants to ask "why?", so the thread stays live and writable while they remain on
 * the problem, and is retired only once they move on.
 */
export function workArchivable(state: WorkAnchorState): boolean {
    return workConcluded(state) && state.leftAnchor;
}
