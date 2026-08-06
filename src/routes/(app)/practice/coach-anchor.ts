import type { WorkAnchorState } from "$lib/ai/session/lifecycle";

/**
 * The trainer's record of the sitting its Coach thread is anchored to
 * (docs/ai-coach-sessions.md §4, §5).
 *
 * This is deliberately **not** the same thing as "is the Coach on screen". Hiding the
 * Coach does not leave the anchor — the student is still on the problem, so reopening
 * rejoins the same thread — but changing problem does. One variable serving both roles
 * is what let a toggled-off Coach skip its release entirely: the anchor was forgotten
 * while the row it pointed at stayed live, holding the unique-index slot and taking the
 * next problem's turns into the previous problem's thread.
 *
 * The conclusion flags live here rather than being read off `answerState` at release
 * time because they have to outlive the on-screen problem: both a skip and a departure
 * load the next problem — resetting the answer state — before the anchor is released.
 */
export interface TrainerCoachAnchor {
    /** The anchored problem, or null when the trainer holds no anchor. */
    problemId: number | null;
    /** A graded submission was written for this sitting. */
    submitted: boolean;
    /** The student explicitly skipped the problem. */
    skipped: boolean;
}

/** No anchor held — the state before the Coach is opened, and after a release. */
export function releasedTrainerAnchor(): TrainerCoachAnchor {
    return { problemId: null, submitted: false, skipped: false };
}

/**
 * Anchor the Coach to a problem.
 *
 * Re-showing the Coach on the problem it is already anchored to **keeps** the existing
 * record: a submit or skip already noted for this sitting must not be forgotten by a
 * toggle, or the thread would look unconcluded and never be archived.
 */
export function openTrainerAnchor(
    current: TrainerCoachAnchor,
    problemId: number,
    submitted: boolean,
): TrainerCoachAnchor {
    if (current.problemId === problemId) return current;
    return { problemId, submitted, skipped: false };
}

/**
 * Has the student moved off the anchored problem? This — not the Coach's visibility —
 * is what `coach.releaseWorkAnchor` waits for.
 */
export function trainerAnchorLeft(
    anchor: TrainerCoachAnchor,
    onScreenProblemId: number | null | undefined,
): boolean {
    return anchor.problemId !== null && anchor.problemId !== onScreenProblemId;
}

/** The half of the anchor the pure lifecycle rules (§5) read. */
export function trainerAnchorWork(
    anchor: TrainerCoachAnchor,
): Pick<WorkAnchorState, "submitted" | "skipped"> {
    return { submitted: anchor.submitted, skipped: anchor.skipped };
}
