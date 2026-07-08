<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import {
        topicLabel,
        ratingIsProvisional,
        type ProblemRow,
        type ProblemRating,
    } from "$lib/library";
    import type { ProblemProgress } from "$lib/trainer";

    interface Props {
        problem: ProblemRow;
        problemRating: ProblemRating | null;
        hasAnswer: boolean;
        showLiveFeedback: boolean;
        focusModeActive: boolean;
        currentSource: string;
        currentProgress: ProblemProgress | null;
        isTest: boolean;
        historyIndex: number;
        historyLength: number;
        onOpenAnswerSubmission: () => void;
    }

    let {
        problem,
        problemRating,
        hasAnswer,
        showLiveFeedback,
        focusModeActive,
        currentSource,
        currentProgress,
        isTest,
        historyIndex,
        historyLength,
        onOpenAnswerSubmission,
    }: Props = $props();

    const iconCls = "size-[1em] shrink-0 leading-none opacity-70";

    let topicName = $derived(problem ? topicLabel(problem.topic) : null);

    let lastReviewedLabel = $derived(
        currentProgress
            ? formatReviewDate(currentProgress.lastSubmissionAt)
            : null,
    );

    // Compact "last reviewed" label: relative for recent, short date otherwise.
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
</script>

<div
    class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-background/80 px-1 pt-2.5 pb-2.5 backdrop-blur-(--backdrop-blur) select-none w-full overflow-visible"
>
    <div
        class="flex items-center gap-2 text-xs font-semibold opacity-50 tracking-wider uppercase text-muted-foreground min-w-0"
    >
        {#if problem.tests?.name}
            <span class="truncate">{problem.tests.name}</span>
            <span class="text-border shrink-0">•</span>
        {/if}
        <span class="shrink-0">#{problem.n + 1}</span>
        {#if topicName}
            <span class="text-border shrink-0">•</span>
            <span class="truncate" title={topicName}>{topicName}</span>
        {/if}
        {#if problemRating}
            <span class="text-border shrink-0">•</span>
            <span
                class="inline-flex items-center gap-0.5 shrink-0 tabular-nums"
                title={`Problem Elo: ${problemRating.rating.toFixed(0)} ± ${problemRating.rd.toFixed(0)}${ratingIsProvisional(problemRating) ? " (provisional)" : ""}`}
            >
                {problemRating.rating.toFixed(0)}
            </span>
        {/if}
    </div>

    <div
        class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground shrink-0"
    >
        {#if !hasAnswer}
            <StatusTag
                status="unanswered"
                size="sm"
                class="border-unsure/60 bg-unsure/20 text-on-unsure-container [--attention-color:var(--color-unsure)] animate-attention-pulse hover:animate-none focus-visible:animate-none motion-reduce:animate-none"
                action={{
                    label: "Suggest",
                    icon: "add",
                    onclick: onOpenAnswerSubmission,
                }}
            />
        {/if}
        {#if showLiveFeedback && !focusModeActive}
            {#if currentSource === "review"}
                <StatusTag status="review" size="sm" />
                {#if currentProgress}
                    <span class="inline-flex items-center gap-1">
                        <Icon name="visibility" class={iconCls} />
                        Seen {currentProgress.timesSeen}×
                    </span>
                    {#if lastReviewedLabel}
                        <span class="text-border">•</span>
                        <span
                            class="inline-flex items-center gap-1"
                            title="Last reviewed"
                        >
                            <Icon name="schedule" class={iconCls} />
                            {lastReviewedLabel}
                        </span>
                    {/if}
                {/if}
            {:else}
                <StatusTag status="new" size="sm" />
            {/if}
        {:else if isTest}
            <span class="font-mono">
                {historyIndex + 1} / {historyLength}
            </span>
        {/if}
    </div>
</div>
