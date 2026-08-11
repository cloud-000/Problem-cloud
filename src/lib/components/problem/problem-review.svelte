<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { StatusTag, type StatusKind } from "$lib/components/status-tag";
    import {
        aopsProblemUrl,
        aopsCommunityUrl,
        type ProblemReviewEntry,
    } from "$lib/library";
    import { cn, formatElapsed, isMultipleChoice } from "$lib/utils";
    import { submissionOutcome } from "$lib/problem-response";
    import Problem from "./problem.svelte";

    let {
        entry,
        showHeader = true,
        autoRevealSolution = true,
        showOrganization = false,
        elapsedMs = null,
        class: className,
    }: {
        entry: ProblemReviewEntry;
        /** Render the AoPS-links + status-tag header. Off for callers (e.g. the
         * history row, the focused test-review modal) that already name the
         * problem themselves — this is the card's *only* identity either way,
         * since the inner `Problem` always renders `header="meta"`. */
        showHeader?: boolean;
        /** Auto-open the solution on a wrong answer (trainer post-test review).
         * Off in long lists so solutions start collapsed. The panel itself is
         * always present (inside `Problem`) when the problem has solutions. */
        autoRevealSolution?: boolean;
        /** Show the problem's mastery and future-plan controls. */
        showOrganization?: boolean;
        /** Time spent on this problem, shown as a header chip. Null hides it. */
        elapsedMs?: number | null;
        class?: string;
    } = $props();

    let mcq = $derived(isMultipleChoice(entry.problem.choices));
    let testHref = $derived(
        aopsCommunityUrl(entry.problem.tests?.aops_category_id),
    );
    let problemHref = $derived(aopsProblemUrl(entry.problem.aops_id));
    // Prefer an explicit skip; otherwise a blank response reads as "skipped".
    // Either way, the graded outcome drives correct/incorrect.
    let skipped = $derived(
        entry.skipped ??
            (mcq
                ? entry.selectedChoice == null
                : !entry.answer || !entry.answer.trim()),
    );
    let status = $derived<StatusKind>(
        submissionOutcome({ skipped, is_correct: entry.correct }),
    );
</script>

<div
    class={cn(
        "rounded-lg border border-border/50 bg-surface-container-lowest p-4",
        className,
    )}
>
    {#if showHeader}
        <div class="mb-3 flex items-center gap-2 text-xs">
            {#if entry.problem.tests?.name}
                {#if testHref}
                    <a
                        href={testHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex min-w-0 items-center gap-0.5 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        title={`Open ${entry.problem.tests.name} on Art of Problem Solving`}
                    >
                        <span class="truncate">{entry.problem.tests.name}</span>
                        <Icon name="open_in_new" class="size-[0.9em] shrink-0" />
                    </a>
                {:else}
                    <span class="truncate font-medium text-muted-foreground">
                        {entry.problem.tests.name}
                    </span>
                {/if}
                <span class="text-border shrink-0">•</span>
            {/if}
            {#if problemHref}
                <a
                    href={problemHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex shrink-0 items-center gap-0.5 font-mono text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    title="Open this problem on Art of Problem Solving"
                >
                    #{entry.problem.n + 1}
                    <Icon name="open_in_new" class="size-[0.9em] shrink-0" />
                </a>
            {:else}
                <span class="font-mono text-muted-foreground shrink-0">
                    #{entry.problem.n + 1}
                </span>
            {/if}
            <StatusTag size="sm" {status} />
            {#if entry.flagged}
                <Icon name="flag" class="size-[1.1em] text-unsure" fill />
            {/if}
            {#if elapsedMs != null}
                <span
                    class="ml-auto inline-flex shrink-0 items-center gap-1 font-mono tabular-nums text-muted-foreground"
                    title="Time spent on this problem"
                >
                    <Icon name="schedule" class="size-[1em]" />
                    {formatElapsed(elapsedMs)}
                </span>
            {/if}
        </div>
    {/if}
    <!-- `header="meta"` unconditionally: this card names the problem when
         `showHeader` is on, and a caller that turns it off (the `/history` row,
         the focused test-review modal) does so precisely because *it* names the
         problem. Either way the inner card must not name it a second time — it
         keeps only the badges and actions, which no wrapper header carries. -->
    <Problem
        problem={entry.problem}
        header="meta"
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
    />
</div>
