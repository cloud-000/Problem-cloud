<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import {
        topicLabel,
        ratingIsProvisional,
        aopsProblemUrl,
        aopsCommunityUrl,
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
        /**
         * Reveal the AoPS thread links on the test name / problem number. Fed the
         * finalized flag so links only appear once submitting can't leak the
         * answer; each link is still omitted when its AoPS id is missing.
         */
        revealLinks?: boolean;
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
        revealLinks = false,
        onOpenAnswerSubmission,
    }: Props = $props();

    const iconCls = "size-[1em] shrink-0 leading-none opacity-70";
    // Linked segments read as clickable in the otherwise-muted bar via a hover
    // underline plus a trailing new-tab glyph. !text-[1em] overrides the
    // Material Symbols stylesheet's default 24px font-size.
    const linkCls = "group inline-flex items-center gap-0.5 min-w-0";
    const linkTextCls = "group-hover:underline underline-offset-2";
    const linkIconCls =
        "shrink-0 !text-[1em] leading-none opacity-60 transition-opacity group-hover:opacity-100";

    let topicName = $derived(problem ? topicLabel(problem.topic) : null);

    let testHref = $derived(
        revealLinks ? aopsCommunityUrl(problem.tests?.aops_category_id) : null,
    );
    let problemHref = $derived(
        revealLinks ? aopsProblemUrl(problem.aops_id) : null,
    );

    let lastReviewedLabel = $derived(
        currentProgress
            ? formatReviewDate(currentProgress.last_submission_at)
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
            {#if testHref}
                <a
                    href={testHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    class={`truncate ${linkCls}`}
                    title={`Open ${problem.tests.name} on Art of Problem Solving`}
                >
                    <span class={`truncate ${linkTextCls}`}>{problem.tests.name}</span>
                    <Icon name="open_in_new" class={linkIconCls} />
                </a>
            {:else}
                <span class="truncate">{problem.tests.name}</span>
            {/if}
            <span class="text-border shrink-0">•</span>
        {/if}
        {#if problemHref}
            <a
                href={problemHref}
                target="_blank"
                rel="noopener noreferrer"
                class={`shrink-0 ${linkCls}`}
                title="Open this problem on Art of Problem Solving"
            >
                <span class={linkTextCls}>#{problem.n + 1}</span>
                <Icon name="open_in_new" class={linkIconCls} />
            </a>
        {:else}
            <span class="shrink-0">#{problem.n + 1}</span>
        {/if}
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
                        Seen {currentProgress.times_seen}×
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
