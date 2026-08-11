<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { GoalProgressBar } from "$lib/components/goal-progress-bar";
    import { Icon } from "$lib/components/icon";
    import { describeTarget, type Goal } from "$lib/goals";
    import { hasRemainingSet } from "$lib/goals/practice";
    import {
        describeScope,
        progressSummary,
        promotionLine,
        type SeriesNames,
    } from "$lib/goals/presentation";
    import type { PromotedGoal } from "$lib/goals/promote";
    import { cn } from "$lib/utils";

    let {
        entry,
        seriesNames,
        busy = false,
        onpractice,
        class: className,
    }: {
        entry: PromotedGoal;
        seriesNames: SeriesNames;
        busy?: boolean;
        onpractice: (goal: Goal) => void;
        class?: string;
    } = $props();

    let goal = $derived(entry.goal);
    // The reason it was promoted, in words — never re-derived here, so the hero
    // and the list below it cannot disagree about what is urgent.
    let lead = $derived(promotionLine(entry));
    let urgent = $derived(
        entry.reason === "streak_today" ||
            (entry.reason === "deadline" && (entry.daysLeft ?? 0) <= 1),
    );
</script>

<div class={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5", className)}>
    <a
        href={resolve(`/goals?goal=${goal.id}`)}
        class="group min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
        <p
            class={cn(
                "type-caption",
                entry.reason === "achieved"
                    ? "text-correct"
                    : urgent
                      ? "text-unsure"
                      : "text-muted-foreground",
            )}
        >
            {lead ?? describeScope(goal.scope, seriesNames)}
        </p>
        <p class="mt-0.5 truncate type-secondary font-medium text-foreground">
            {goal.title}
        </p>
        {#if entry.result}
            <GoalProgressBar
                result={entry.result}
                met={entry.result.isTargetMet}
                class="mt-2 max-w-sm"
            />
            <p class="mt-1 type-caption text-muted-foreground">
                {progressSummary(entry.result)} · {describeTarget(goal.target)}
            </p>
        {/if}
    </a>

    <div class="shrink-0">
        {#if entry.reason === "achieved"}
            <Button href={resolve(`/goals?goal=${goal.id}`)} variant="ghost" size="sm">
                See it
                <Icon name="arrow_forward" />
            </Button>
        {:else}
            <Button
                variant="outline"
                size="sm"
                onclick={() => onpractice(goal)}
                disabled={busy}
            >
                <Icon name="sprint" class="size-[1em]" />
                {hasRemainingSet(goal) ? "Practise what's left" : "Practise"}
            </Button>
        {/if}
    </div>
</div>
