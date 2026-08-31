<script lang="ts">
    import { Button } from "$lib/components/button";
    import { GoalProgress } from "$lib/components/goal-progress";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import {
        describeTarget,
        goalStatus,
        type Goal,
        type GoalProgressData,
        type GoalProgressResult,
    } from "$lib/goals";
    import { cn } from "$lib/utils";
    import { practiceActionLabel } from "$lib/goals/practice";
    import {
        achievementNote,
        consequentialStatus,
        describeScope,
        formatDate,
        type SeriesNames,
    } from "$lib/goals/presentation";

    let {
        goal,
        result,
        data = {},
        seriesNames,
        now,
        busy = false,
        onback,
        onpractice,
        onedit,
        onarchive,
        ondelete,
    }: {
        goal: Goal;
        result: GoalProgressResult | null;
        /** The raw family row used by the shared family-specific progress view. */
        data?: GoalProgressData;
        seriesNames: SeriesNames;
        now: Date;
        busy?: boolean;
        onback: () => void;
        onpractice: (goal: Goal) => void;
        onedit: (goal: Goal) => void;
        onarchive: (goal: Goal, archived: boolean) => void;
        ondelete: (goal: Goal) => void;
    } = $props();

    let statusLine = $derived(consequentialStatus(goal, result, data, now));
    let achieved = $derived(achievementNote(goal, result));
    let lifecycle = $derived(goalStatus(goal));
</script>

<!-- Same width as the goal list: the detail is a drill-down of that page, and a
     narrower shell made moving between the two look like a different app. -->
<Page.Root width="standard">
    <Page.Header
        title={goal.title}
    >
        {#snippet eyebrow()}
            <span class="flex items-center gap-3">
                <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onclick={onback}
                >
                    <Icon name="arrow_back" class="size-[1em]" />
                    All goals
                </button>
                <span
                    class={cn(
                        "text-xxs font-medium",
                        statusLine.tone === "success" && "text-correct",
                        statusLine.tone === "attention" && "text-unsure",
                        statusLine.tone === "archived" && "text-muted-foreground",
                        statusLine.tone === "muted" && "text-muted-foreground",
                    )}
                >
                    {statusLine.label}
                </span>
            </span>
        {/snippet}
        {#snippet actions()}
            <Button onclick={() => onpractice(goal)} disabled={busy}>
                <Icon name="sprint" class="size-[1em]" />
                {practiceActionLabel(goal)}
            </Button>
        {/snippet}
    </Page.Header>

    <Page.Section title="Progress">
        {#if result}
            <GoalProgress {goal} {result} {data} {now} />
            {#if achieved}
                <p class="mt-3 type-secondary text-correct">{achieved}</p>
            {/if}
        {:else}
            <p class="type-secondary text-muted-foreground">
                This goal could not be measured just now. Reload to try again, or
                edit it to choose a finish line again.
            </p>
        {/if}
    </Page.Section>

    <Page.Section title="The commitment">
        <dl class="flex flex-col gap-2 border-t border-border/60 pt-4">
            <div class="flex items-baseline justify-between gap-3">
                <dt class="type-secondary text-muted-foreground">Scope</dt>
                <dd class="type-secondary text-right text-foreground">
                    {describeScope(goal.scope, seriesNames)}
                </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
                <dt class="type-secondary text-muted-foreground">Finish line</dt>
                <dd class="type-secondary text-right text-foreground">
                    {describeTarget(goal.target)}
                </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
                <dt class="type-secondary text-muted-foreground">Deadline</dt>
                <dd class="type-secondary text-right text-foreground">
                    {formatDate(goal.deadline) ?? "None"}
                </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
                <dt class="type-secondary text-muted-foreground">Set on</dt>
                <dd class="type-secondary text-right text-foreground">
                    {formatDate(goal.createdAt) ?? "—"}
                </dd>
            </div>
        </dl>
    </Page.Section>

    <Page.Section title="Manage">
        <div class="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button variant="outline" onclick={() => onedit(goal)} disabled={busy}>
                Edit
            </Button>
            <Button
                variant="ghost"
                onclick={() => onarchive(goal, lifecycle !== "archived")}
                disabled={busy}
            >
                {lifecycle === "archived" ? "Restore" : "Archive"}
            </Button>
            <Button variant="ghost" onclick={() => ondelete(goal)} disabled={busy}>
                <span class="text-destructive">Delete</span>
            </Button>
        </div>
        <p class="mt-2 text-xxs text-muted-foreground">
            Archiving keeps the goal readable but stops promoting it. Deleting is
            permanent.
        </p>
    </Page.Section>
</Page.Root>
