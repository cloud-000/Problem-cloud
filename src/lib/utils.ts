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
 * always `n + 1`. Shared rather than formatted at each call site because the label is not
 * only decoration: it is the Coach's context chip, the stored `context_summary`, and the
 * line the model reads in the system prompt, so drift here misnames the problem to the
 * model, not just to the reader.
 */
export function problemLabel(problem: {
    n: number;
    tests?: { name?: string | null } | null;
}): string {
    const number = problem.n + 1;
    return problem.tests?.name ? `${problem.tests.name} #${number}` : `Problem #${number}`;
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
