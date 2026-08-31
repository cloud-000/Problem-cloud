<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { GoalProgress } from "$lib/components/goal-progress";
    import { Icon } from "$lib/components/icon";
    import { type Goal } from "$lib/goals";
    import { practiceActionLabel } from "$lib/goals/practice";
    import {
        describeScope,
        promotionLine,
        type SeriesNames,
    } from "$lib/goals/presentation";
    import type { PromotedGoal } from "$lib/goals/promote";
    import { cn } from "$lib/utils";

    let {
        entry,
        seriesNames,
        now,
        busy = false,
        onpractice,
        class: className,
    }: {
        entry: PromotedGoal;
        seriesNames: SeriesNames;
        now: Date;
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
        <p class="mt-0.5 type-secondary font-medium text-foreground">
            {goal.title}
        </p>
        {#if entry.result}
            <GoalProgress
                {goal}
                result={entry.result}
                data={entry.familyData}
                {now}
                compact
                class="mt-2 w-full"
            />
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
                {practiceActionLabel(goal)}
            </Button>
        {/if}
    </div>
</div>
