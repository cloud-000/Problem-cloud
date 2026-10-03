<script lang="ts">
    import type { Snippet } from "svelte";
    import type { ProblemReviewEntry } from "$lib/library";
    import { isMultipleChoice } from "$lib/utils";
    import { submissionOutcome } from "$lib/problem-response";
    import Problem from "./problem.svelte";

    let {
        entry,
        showHeader = true,
        autoRevealSolution = false,
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
        /** Opt-in auto-open of the solution on a wrong answer. Off by
         * default — solutions start collapsed everywhere unless a caller
         * explicitly opts in. */
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

    // Self-check playground (Library-like): drafts start from the graded
    // response but never write back to `entry` or the DB. Persistent
    // correct/incorrect styling stays pinned to the recorded attempt (via
    // `gradedResponse`) while the rest of the choices stay clickable with
    // ephemeral instant-feedback; the header keeps the graded record.
    // Synced in `$effect.pre` (before paint) so a reused card (e.g. the
    // test-review modal stepping between problems) re-seeds without flashing.
    let draftAnswer = $state("");
    let draftChoice = $state<number | null>(null);
    let draftEliminated = $state<number[]>([]);
    $effect.pre(() => {
        draftAnswer = entry.answer ?? "";
        draftChoice = entry.selectedChoice ?? null;
        draftEliminated = [];
    });
</script>

<Problem
    problem={entry.problem}
    header={showHeader ? "review" : "meta"}
    attemptStatus={showHeader ? attemptStatus : undefined}
    flagged={showHeader ? entry.flagged : false}
    elapsedMs={showHeader ? elapsedMs : null}
    mastery={entry.progress?.mastery}
    engagement={entry.progress?.engagement}
    bind:answer={draftAnswer}
    bind:selectedChoice={draftChoice}
    bind:eliminated={draftEliminated}
    gradedResponse={{
        selectedChoice: entry.selectedChoice,
        answer: entry.answer,
    }}
    showAnswerState={true}
    disabled={false}
    isInstantFeedback={true}
    solution={autoRevealSolution && entry.correct === false
        ? "open"
        : "collapsed"}
    {showOrganization}
    class={className}
    {actions}
/>
