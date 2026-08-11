<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        describeTarget,
        targetOf,
        type Goal,
        type GoalProgressResult,
    } from "$lib/goals";
    import { cn } from "$lib/utils";
    import { GoalProgressBar } from "$lib/components/goal-progress-bar";
    import { hasRemainingSet } from "$lib/goals/practice";
    import {
        achievementNote,
        deadlineLabel,
        describeScope,
        progressSummary,
        statusChip,
        type SeriesNames,
    } from "$lib/goals/presentation";

    let {
        goal,
        result,
        seriesNames,
        now,
        busy = false,
        onopen,
        onpractice,
    }: {
        goal: Goal;
        /** null = unreadable target, or a family that failed to load. */
        result: GoalProgressResult | null;
        seriesNames: SeriesNames;
        now: Date;
        busy?: boolean;
        onopen: (goal: Goal) => void;
        onpractice: (goal: Goal) => void;
    } = $props();

    let chip = $derived(statusChip(goal, now));
    let due = $derived(deadlineLabel(goal, now));
    let achieved = $derived(achievementNote(goal, result));
    // A stored target is untrusted: an unknown `type` must render as one
    // unreadable card, never a thrown page (architecture doc §7).
    let readable = $derived(Boolean(targetOf(goal.target)));
</script>

<div
    class={cn(
        "flex flex-col gap-3 border-b border-border/60 py-4",
        goal.archivedAt && "opacity-60",
    )}
>
    <div class="flex items-start justify-between gap-3">
        <button
            type="button"
            class="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            onclick={() => onopen(goal)}
        >
            <span class="type-section-title block truncate text-foreground">
                {goal.title}
            </span>
            <span class="mt-0.5 block truncate type-secondary text-muted-foreground">
                {describeTarget(goal.target)} · {describeScope(goal.scope, seriesNames)}
            </span>
        </button>

        <span
            class={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xxs font-medium",
                chip.tone === "achieved" && "bg-correct/10 text-correct",
                chip.tone === "overdue" && "bg-unsure/10 text-unsure",
                chip.tone === "archived" && "bg-surface-container-high text-muted-foreground",
                chip.tone === "active" && "bg-primary/10 text-primary",
            )}
        >
            {chip.label}
        </span>
    </div>

    {#if result}
        <div class="flex flex-col gap-1.5">
            <GoalProgressBar {result} met={result.isTargetMet} />
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span class="type-secondary text-foreground">
                    {progressSummary(result)}
                </span>
                {#if due}
                    <span
                        class={cn(
                            "text-xxs",
                            due.overdue ? "text-unsure" : "text-muted-foreground",
                        )}
                    >
                        {due.text}
                    </span>
                {/if}
            </div>
        </div>
    {:else}
        <p class="type-secondary text-muted-foreground">
            {readable
                ? "Not measured just now — reload to try again."
                : "This goal's target could not be read. Open it to fix or delete it."}
        </p>
    {/if}

    <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xxs text-muted-foreground">{achieved ?? ""}</span>
        <div class="flex items-center gap-1">
            <Button
                variant="ghost"
                size="xs"
                onclick={() => onpractice(goal)}
                disabled={busy}
            >
                <Icon name="sprint" class="size-[1em]" />
                {hasRemainingSet(goal) ? "Practise what's left" : "Practice"}
            </Button>
            <Button variant="ghost" size="xs" onclick={() => onopen(goal)}>
                Details
            </Button>
        </div>
    </div>
</div>
