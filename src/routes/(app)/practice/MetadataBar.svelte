<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        aopsCommunityUrl,
        aopsProblemUrl,
        ratingIsProvisional,
        topicLabel,
        type ProblemRating,
        type ProblemRow,
    } from "$lib/library";
    import type { ProblemProgress } from "$lib/trainer";

    interface Props {
        problem: ProblemRow;
        problemRating: ProblemRating | null;
        showLiveFeedback: boolean;
        focusModeActive: boolean;
        currentSource: string;
        currentProgress: ProblemProgress | null;
        isTest: boolean;
        historyIndex: number;
        historyLength: number;
        revealLinks?: boolean;
    }

    let {
        problem,
        problemRating,
        showLiveFeedback,
        focusModeActive,
        currentSource,
        currentProgress,
        isTest,
        historyIndex,
        historyLength,
        revealLinks = false,
    }: Props = $props();

    let detailsOpen = $state(false);
    let topicName = $derived(topicLabel(problem.topic));
    let testHref = $derived(
        revealLinks ? aopsCommunityUrl(problem.tests?.aops_category_id) : null,
    );
    let problemHref = $derived(
        revealLinks ? aopsProblemUrl(problem.aops_id) : null,
    );
    let sourceLabel = $derived(
        problem.tests?.name
            ? `${problem.tests.name} · Problem ${problem.n + 1}`
            : `Problem ${problem.n + 1}`,
    );

    function formatReviewDate(iso: string | null) {
        if (!iso) return null;
        const then = new Date(iso);
        const days = Math.floor((Date.now() - then.getTime()) / 86400000);
        if (days <= 0) return "today";
        if (days === 1) return "yesterday";
        if (days < 30) return `${days}d ago`;
        return then.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });
    }

    let lastReviewedLabel = $derived(
        formatReviewDate(currentProgress?.last_submission_at ?? null),
    );
</script>

<div class="w-full max-w-full border-b border-border/60">
    <div class="flex min-h-11 items-center justify-between gap-4 py-2">
        <p class="min-w-0 truncate type-caption text-muted-foreground" title={sourceLabel}>
            {sourceLabel}
        </p>
        {#if !focusModeActive}
            <Button
                variant="ghost"
                size="icon-sm"
                class="size-9 shrink-0 text-muted-foreground"
                onclick={() => (detailsOpen = !detailsOpen)}
                aria-expanded={detailsOpen}
                aria-label={detailsOpen ? "Hide problem details" : "Show problem details"}
                title={detailsOpen ? "Hide details" : "Show details"}
            >
                <Icon name={detailsOpen ? "expand_less" : "expand_more"} />
            </Button>
        {/if}
    </div>

    {#if detailsOpen && !focusModeActive}
        <div class="grid gap-x-6 gap-y-3 border-t border-border/50 py-4 type-caption text-muted-foreground sm:grid-cols-2">
            {#if topicName}
                <p><span class="text-foreground">Topic</span> · {topicName}</p>
            {/if}
            {#if problemRating}
                <p class="font-mono tabular-nums">
                    <span class="font-sans text-foreground">Problem rating</span> ·
                    {Math.round(problemRating.rating)} ± {Math.round(problemRating.rd)}{ratingIsProvisional(problemRating)
                        ? " · provisional"
                        : ""}
                </p>
            {/if}
            {#if showLiveFeedback}
                <p>
                    <span class="text-foreground">Queue</span> ·
                    {currentSource === "review" ? "Review" : "New problem"}
                    {#if currentProgress}
                        · Seen {currentProgress.times_seen}×{#if lastReviewedLabel}
                            · {lastReviewedLabel}
                        {/if}
                    {/if}
                </p>
            {:else if isTest}
                <p class="font-mono tabular-nums">
                    <span class="font-sans text-foreground">Test position</span> ·
                    {historyIndex + 1} of {historyLength}
                </p>
            {/if}
            {#if testHref || problemHref}
                <div class="flex flex-wrap items-center gap-4">
                    {#if testHref}
                        <button
                            type="button"
                            onclick={() => window.open(testHref, "_blank", "noopener,noreferrer")}
                            class="inline-flex items-center gap-1 text-foreground hover:underline"
                        >
                            Test source <Icon name="open_in_new" class="size-[1em]" />
                        </button>
                    {/if}
                    {#if problemHref}
                        <button
                            type="button"
                            onclick={() => window.open(problemHref, "_blank", "noopener,noreferrer")}
                            class="inline-flex items-center gap-1 text-foreground hover:underline"
                        >
                            Problem source <Icon name="open_in_new" class="size-[1em]" />
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>
