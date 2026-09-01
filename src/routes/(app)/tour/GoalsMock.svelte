<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    type FakeGoal = {
        id: string;
        title: string;
        scope: string;
        current: number;
        target: number;
        unit: string;
    };

    const goals: FakeGoal[] = [
        {
            id: "geometry",
            title: "Solve 20 AMC 10 Geometry problems",
            scope: "AMC 10 · Geometry",
            current: 7,
            target: 20,
            unit: "problems",
        },
        {
            id: "algebra",
            title: "80% first-try on Algebra",
            scope: "AMC 12 · Algebra",
            current: 12,
            target: 15,
            unit: "attempts",
        },
    ];

    let leadId = $state(goals[0]?.id ?? "geometry");
    let lead = $derived(goals.find((goal) => goal.id === leadId) ?? goals[0]);
</script>

<div
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest"
>
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <p class="type-secondary font-medium text-foreground">Goals</p>
        <span class="type-caption text-muted-foreground">Sample</span>
    </div>

    <ul class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1">
        {#each goals as goal (goal.id)}
            {@const fill = Math.round((goal.current / goal.target) * 100)}
            {@const isLead = goal.id === leadId}
            <li>
                <button
                    type="button"
                    class={cn(
                        "flex w-full flex-col gap-2 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        isLead && "bg-muted/50",
                    )}
                    aria-pressed={isLead}
                    onclick={() => (leadId = goal.id)}
                >
                    <div class="flex items-start justify-between gap-3">
                        <span class="min-w-0">
                            <span class="block type-secondary font-medium text-foreground">
                                {goal.title}
                            </span>
                            <span class="mt-0.5 block type-caption text-muted-foreground">
                                {goal.scope}
                            </span>
                        </span>
                        {#if isLead}
                            <span class="inline-flex shrink-0 items-center gap-1 type-caption text-foreground">
                                <Icon name="flag" class="size-3.5" fill />
                                Lead
                            </span>
                        {/if}
                    </div>
                    <div
                        class="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={goal.target}
                        aria-valuenow={goal.current}
                    >
                        <div
                            class="h-full rounded-full bg-primary"
                            style:width={`${fill}%`}
                        ></div>
                    </div>
                    <span class="type-caption text-muted-foreground">
                        {goal.current} of {goal.target} {goal.unit}
                    </span>
                </button>
            </li>
        {/each}
    </ul>

    <p class="border-t border-border px-4 py-2 type-caption text-muted-foreground">
        {#if lead}
            Home follows “{lead.title}”. Tap a card to change the lead.
        {/if}
    </p>
</div>
