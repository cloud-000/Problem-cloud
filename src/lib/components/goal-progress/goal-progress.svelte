<script lang="ts">
    import { GoalProgressBar } from "$lib/components/goal-progress-bar";
    import type { Goal, GoalProgressData, GoalProgressResult } from "$lib/goals";
    import { goalProgressView } from "$lib/goals/presentation";
    import { cn } from "$lib/utils";

    let {
        goal,
        result,
        data = {},
        now = new Date(),
        compact = false,
        class: className,
    }: {
        goal: Pick<Goal, "target">;
        result: GoalProgressResult;
        data?: GoalProgressData;
        now?: Date;
        compact?: boolean;
        class?: string;
    } = $props();

    let view = $derived(goalProgressView(goal, result, data, now));
</script>

{#if view}
    <div class={cn("flex flex-col gap-2", compact && "gap-1.5", className)}>
        {#if view.family === "set"}
            {#if view.showBar}
                <GoalProgressBar result={result} met={result.isTargetMet} />
            {/if}
            <div class="flex flex-col gap-0.5">
                <p class="type-secondary text-foreground">{view.primary}</p>
                {#if view.coverage}
                    <p class="type-caption text-muted-foreground">{view.coverage}</p>
                {/if}
            </div>
        {:else if view.family === "volume"}
            <GoalProgressBar result={result} met={result.isTargetMet} />
            <p class="type-secondary text-foreground">{view.primary}</p>
            {#if view.note}
                <p class="type-caption text-muted-foreground">{view.note}</p>
            {/if}
        {:else if view.family === "accuracy"}
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="type-secondary text-foreground">{view.performance}</p>
                <p class="type-caption text-muted-foreground">{view.target}</p>
            </div>
            <p class="type-caption text-muted-foreground">{view.measured}</p>
            {#if view.next}
                <p class="type-caption text-muted-foreground">{view.next}</p>
            {/if}
        {:else if view.family === "speed"}
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="type-secondary text-foreground">{view.average}</p>
                <p class="type-caption text-muted-foreground">{view.target}</p>
            </div>
            <p class="type-caption text-foreground">{view.accuracy}</p>
            <p class="type-caption text-muted-foreground">{view.measured}</p>
            {#if view.next}
                <p class="type-caption text-muted-foreground">{view.next}</p>
            {/if}
        {:else}
            <div
                class="flex flex-col gap-2"
                aria-label={`${view.day}; ${view.today}`}
            >
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p class="type-secondary text-foreground">{view.day}</p>
                    <p class="type-caption text-muted-foreground">{view.today}</p>
                </div>
                <div class="flex gap-1" aria-hidden="true">
                    {#each Array(view.displayDays) as _, index (index)}
                        <span
                            class={cn(
                                "h-2 flex-1 rounded-full",
                                index < view.filledDays
                                    ? "bg-primary"
                                    : "bg-surface-container-high",
                            )}
                        ></span>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
{/if}
