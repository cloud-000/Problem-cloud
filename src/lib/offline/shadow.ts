import {
    glickoMatchPreview,
    type PlayerRating,
    type ProblemRating,
} from "$lib/library";

/**
 * Advance the runtime-only selector center after one graded offline answer.
 * The server rating remains authoritative; this value is never persisted,
 * displayed, or synchronized.
 */
export function advanceShadowRating(
    shadow: number,
    downloadedPlayer: PlayerRating,
    problem: ProblemRating,
    correct: boolean,
): number {
    const preview = glickoMatchPreview(
        { ...downloadedPlayer, rating: shadow },
        problem,
    );
    return shadow + (correct ? preview.deltaWin : preview.deltaLoss);
}
