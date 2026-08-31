<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { GoalProgress } from "$lib/components/goal-progress";
    import { targetOf, type Goal, type GoalProgressData, type GoalProgressResult } from "$lib/goals";
    import { cn } from "$lib/utils";
    import { practiceActionLabel } from "$lib/goals/practice";
    import {
        consequentialStatus,
        describeScope,
        type SeriesNames,
    } from "$lib/goals/presentation";

    let {
        goal,
        result,
        data = {},
        seriesNames,
        now,
        busy = false,
        onopen,
        onpractice,
    }: {
        goal: Goal;
        /** null = unreadable target, or a family that failed to load. */
        result: GoalProgressResult | null;
        data?: GoalProgressData;
        seriesNames: SeriesNames;
        now: Date;
        busy?: boolean;
        onopen: (goal: Goal) => void;
        onpractice: (goal: Goal) => void;
    } = $props();

    let status = $derived(consequentialStatus(goal, result, data, now));
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
            title={goal.title}
        >
            <span class="type-section-title block truncate text-foreground">
                {goal.title}
            </span>
            <span class="mt-0.5 block truncate type-secondary text-muted-foreground">
                {describeScope(goal.scope, seriesNames)}
            </span>
        </button>

        <span
            class={cn(
                "shrink-0 text-right text-xxs font-medium",
                status.tone === "success" && "text-correct",
                status.tone === "attention" && "text-unsure",
                status.tone === "archived" && "text-muted-foreground",
                status.tone === "muted" && "text-muted-foreground",
            )}
        >
            {status.label}
        </span>
    </div>

    {#if result}
        <GoalProgress goal={goal} {result} {data} {now} compact />
    {:else}
        <p class="type-secondary text-muted-foreground">
            {readable
                ? "Not measured just now — reload to try again."
                : "This goal's target could not be read. Open it to fix or delete it."}
        </p>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2">
        <div class="flex items-center gap-1">
            <Button
                variant="ghost"
                size="xs"
                onclick={() => onpractice(goal)}
                disabled={busy}
            >
                <Icon name="sprint" class="size-[1em]" />
                {practiceActionLabel(goal)}
            </Button>
            <Button variant="ghost" size="xs" onclick={() => onopen(goal)}>
                Details
            </Button>
        </div>
    </div>
</div>
