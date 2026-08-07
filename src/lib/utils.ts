import { cn } from "tailwind-variants";

export { cn };

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
    ref?: U | null;
};

/** Stopwatch-style elapsed time: `m:ss` once past a minute, else `Ns`. */
export function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0
        ? `${minutes}:${String(seconds).padStart(2, "0")}`
        : `${seconds}s`;
}

/**
 * How a problem names itself: `2023 AMC 10A #18`, or `Problem #18` untethered.
 *
 * **`problems.n` is 0-based** — problem #1 stores `n = 0` — so the displayed number is
 * always `n + 1`. Shared rather than formatted at each call site so every visible label,
 * including the Coach's context chip, names the problem consistently. Model context is
 * resolved separately from the typed problem reference.
 */
export function problemLabel(problem: {
    n: number;
    tests?: { name?: string | null } | null;
}): string {
    const number = problem.n + 1;
    return problem.tests?.name ? `${problem.tests.name} #${number}` : `Problem #${number}`;
}

/**
 * Whether a problem's `choices` are options to pick from.
 *
 * `problems.choices` is overloaded and the distinction is load-bearing: more than one
 * entry is a multiple-choice list, but a **single** entry is a computational
 * free-response problem whose lone element *is the answer* (`choices[answer_index]`,
 * and `answer_index` can only be `0` there). An empty or null array is an answerless
 * stub. So `choices` is safe to show only when this returns true — anywhere else it
 * discloses the answer key, which is why this predicate is shared rather than
 * re-derived. The trainer hides the list for free-response for the same reason.
 */
export function isMultipleChoice(choices?: string[] | null): boolean {
    return (choices?.length ?? 0) > 1;
}

export function formatProblemText(
    statement: string,
    isChoices: boolean = true,
): string {
    if (isChoices) {
        return statement
            .replace(
                /\s*\$?\s*\\textbf\{\(A\)\}[\s\S]*?(?:\\textbf\{\([B-E]\)\}[\s\S]*?)+\$?\s*$/u,
                "",
            )
            .trimEnd();
    }
    return statement;
}
