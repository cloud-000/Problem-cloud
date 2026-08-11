<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import {
        describeTarget,
        goalStatus,
        targetOf,
        type Goal,
        type GoalProgressResult,
        type SetData,
    } from "$lib/goals";
    import { cn } from "$lib/utils";
    import { GoalProgressBar } from "$lib/components/goal-progress-bar";
    import { hasRemainingSet } from "$lib/goals/practice";
    import {
        achievementNote,
        deadlineLabel,
        describeScope,
        formatDate,
        formatMetric,
        progressSummary,
        sampleNote,
        statusChip,
        type SeriesNames,
    } from "$lib/goals/presentation";

    let {
        goal,
        result,
        setData = null,
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
        /** The set family's raw row, when this goal is in it: the drill-down
         * numbers (§4) come from the same request the card was evaluated from,
         * never from a second count. */
        setData?: SetData | null;
        seriesNames: SeriesNames;
        now: Date;
        busy?: boolean;
        onback: () => void;
        onpractice: (goal: Goal) => void;
        onedit: (goal: Goal) => void;
        onarchive: (goal: Goal, archived: boolean) => void;
        ondelete: (goal: Goal) => void;
    } = $props();

    let chip = $derived(statusChip(goal, now));
    let due = $derived(deadlineLabel(goal, now));
    let achieved = $derived(achievementNote(goal, result));
    let note = $derived(result ? sampleNote(result) : null);
    let status = $derived(goalStatus(goal));
    let target = $derived(targetOf(goal.target));

    // Remaining, for the one family that has a remaining set. Attempted and
    // solved are both counted over the eligible denominator, so neither can
    // exceed it and this subtraction is always the real number of problems the
    // handoff below will draw from.
    let remaining = $derived.by(() => {
        if (!setData || !target) return null;
        if (target.type === "attempted_count" || target.type === "attempted_percent") {
            return {
                count: Math.max(0, setData.eligibleTotal - setData.attempted),
                verb: "no graded attempt yet",
            };
        }
        if (target.type === "solved_count" || target.type === "solved_percent") {
            return {
                count: Math.max(0, setData.eligibleTotal - setData.solved),
                verb: "not solved yet",
            };
        }
        return null;
    });
</script>

<!-- Same width as the goal list: the detail is a drill-down of that page, and a
     narrower shell made moving between the two look like a different app. -->
<Page.Root width="standard">
    <Page.Header
        title={goal.title}
        description={`${describeTarget(goal.target)} in ${describeScope(goal.scope, seriesNames)}.`}
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
                        "rounded-full px-2 py-0.5 text-xxs font-medium",
                        chip.tone === "achieved" && "bg-correct/10 text-correct",
                        chip.tone === "overdue" && "bg-unsure/10 text-unsure",
                        chip.tone === "archived" &&
                            "bg-surface-container-high text-muted-foreground",
                        chip.tone === "active" && "bg-primary/10 text-primary",
                    )}
                >
                    {chip.label}
                </span>
            </span>
        {/snippet}
        {#snippet actions()}
            <Button onclick={() => onpractice(goal)} disabled={busy}>
                <Icon name="sprint" class="size-[1em]" />
                {hasRemainingSet(goal) ? "Practise what's left" : "Practice"}
            </Button>
        {/snippet}
    </Page.Header>

    <Page.Section title="Where you are">
        {#if result}
            <div class="flex flex-col gap-3">
                <div class="flex items-end justify-between gap-3">
                    <span class="type-page-title text-foreground">
                        {result.status === "insufficient_data"
                            ? "—"
                            : formatMetric(result.currentValue, result.unit)}
                    </span>
                    <span class="type-secondary text-muted-foreground">
                        {progressSummary(result)}
                    </span>
                </div>
                <GoalProgressBar {result} met={result.isTargetMet} />
                <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span class="text-xxs text-muted-foreground">{note ?? ""}</span>
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
                {#if achieved}
                    <p class="type-secondary text-correct">{achieved}</p>
                {/if}
            </div>
        {:else}
            <p class="type-secondary text-muted-foreground">
                {target
                    ? "This goal could not be measured just now. Reload to try again."
                    : "This goal's target could not be read — edit it to choose a finish line again, or delete it."}
            </p>
        {/if}
    </Page.Section>

    {#if remaining}
        <Page.Section
            title="What's left"
            description="Counted over the same eligible scope the goal is measured on."
        >
            <div
                class="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4"
            >
                <p class="type-secondary text-foreground">
                    <span class="font-semibold">{remaining.count}</span>
                    of {setData?.eligibleTotal} problems in scope have {remaining.verb}.
                </p>
                <Button variant="outline" onclick={() => onpractice(goal)} disabled={busy}>
                    <Icon name="sprint" class="size-[1em]" />
                    Practise these
                </Button>
            </div>
        </Page.Section>
    {/if}

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
                onclick={() => onarchive(goal, status !== "archived")}
                disabled={busy}
            >
                {status === "archived" ? "Restore" : "Archive"}
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
