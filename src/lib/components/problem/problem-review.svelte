<script lang="ts">
    import type { Snippet } from "svelte";
    import type { ProblemReviewEntry } from "$lib/library";
    import { isMultipleChoice } from "$lib/utils";
    import { submissionOutcome } from "$lib/problem-response";
    import Problem from "./problem.svelte";

    let {
        entry,
        showHeader = true,
        autoRevealSolution = true,
        showOrganization = false,
        elapsedMs = null,
        class: className,
        actions,
    }: {
        entry: ProblemReviewEntry;
        /** Render the unified review header. Off for callers (e.g. the
         * history row, the focused test-review modal) that already name the
         * problem themselves, rendering `header="meta"` to avoid repeating identity. */
        showHeader?: boolean;
        /** Auto-open the solution on a wrong answer (trainer post-test review).
         * Off in long lists so solutions start collapsed. */
        autoRevealSolution?: boolean;
        /** Show the problem's mastery and future-plan controls. */
        showOrganization?: boolean;
        /** Time spent on this problem, shown as a header chip. Null hides it. */
        elapsedMs?: number | null;
        class?: string;
        /** Additional action elements rendered in the header nav (e.g. expand modal button). */
        actions?: Snippet;
    } = $props();

    let mcq = $derived(isMultipleChoice(entry.problem.choices));
    let skipped = $derived(
        entry.skipped ??
            (mcq
                ? entry.selectedChoice == null
                : !entry.answer || !entry.answer.trim()),
    );
    let attemptStatus = $derived(
        submissionOutcome({ skipped, is_correct: entry.correct }),
    );
</script>

<Problem
    problem={entry.problem}
    header={showHeader ? "review" : "meta"}
    attemptStatus={showHeader ? attemptStatus : undefined}
    flagged={showHeader ? entry.flagged : false}
    elapsedMs={showHeader ? elapsedMs : null}
    mastery={entry.progress?.mastery}
    engagement={entry.progress?.engagement}
    selectedChoice={entry.selectedChoice}
    answer={entry.answer}
    showAnswerState={true}
    disabled={true}
    solution={autoRevealSolution && entry.correct === false
        ? "open"
        : "collapsed"}
    {showOrganization}
    class={className}
    {actions}
/>
