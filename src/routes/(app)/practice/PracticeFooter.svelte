<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { PlayerRating } from "$lib/library";
    import { cn } from "$lib/utils";
    import { fade } from "svelte/transition";
    import { deviceDetails } from "$lib/mobile.svelte";
    import { shell } from "$lib/state/shell.svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { onMount } from "svelte";
    import { deriveFooterViewState } from "./footer-state";

    let {
        gradeImmediately,
        isLatest,
        submitted,
        paused,
        focusModeActive,
        canGoBack,
        segmented = false,
        canSegmentForward = false,
        lastSegment = true,
        revealMode = false,
        segmentRevealed = false,
        onAdvanceSegment,
        submittingTest,
        cannotSubmit,
        hasAnswer,
        answerContributionAvailable,
        triesUsed,
        triesPerProblem,
        triesRemaining,
        playerRating,
        ratingDelta,
        correct,
        coachAvailable = false,
        coachMode = false,
        onBack,
        onReport,
        onForward,
        onSkip,
        onJumpToLatest,
        onLoadProblem,
        onSubmitAnswer,
        onSubmitTest,
        onToggleCoach,
    }: {
        gradeImmediately: boolean;
        isLatest: boolean;
        submitted: boolean;
        paused: boolean;
        focusModeActive: boolean;
        canGoBack: boolean;
        /** Segmented Test pacing: replaces the whole-test footer with per-segment lock+advance. */
        segmented?: boolean;
        /** Whether Next can step to another problem within the current segment. */
        canSegmentForward?: boolean;
        /** Whether the current segment is the last (its submit ends the test). */
        lastSegment?: boolean;
        /** Countdown per-segment reveal: the primary button grades in place first. */
        revealMode?: boolean;
        /** Reveal mode: the current segment has been graded and is showing its result. */
        segmentRevealed?: boolean;
        onAdvanceSegment?: () => void;
        submittingTest: boolean;
        cannotSubmit: boolean;
        hasAnswer: boolean;
        answerContributionAvailable: boolean;
        triesUsed: number;
        triesPerProblem: number;
        triesRemaining: number;
        playerRating: PlayerRating | null;
        ratingDelta: number | null;
        correct: boolean | null;
        coachAvailable?: boolean;
        coachMode?: boolean;
        onBack: () => void;
        onReport: () => void;
        onForward: () => void;
        onSkip: () => void;
        onJumpToLatest: () => void;
        onLoadProblem: () => void;
        onSubmitAnswer: () => void;
        onSubmitTest: () => void;
        onToggleCoach?: () => void;
    } = $props();

    let view = $derived(
        deriveFooterViewState({
            gradeImmediately,
            isLatest,
            submitted,
            paused,
            focusMode: focusModeActive,
            canGoBack,
        }),
    );

    const portraitQuery = new MediaQuery("(orientation: portrait)", false);
    let isMobilePortrait = $derived(
        deviceDetails.isMobile && portraitQuery.current,
    );
    // While the trainer bar is up, the app shell drops its mobile bottom nav.
    onMount(() => shell.suppressMobileNav());
</script>

<footer
    class={cn(
        "sticky bottom-0 z-30 grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-t border-border/60 bg-background px-3 py-2",
        // Standing in for the nav bar means owning its safe-area inset (home
        // indicator / Safari toolbar).
        isMobilePortrait && "pb-[calc(0.25rem+var(--safe-area-bottom))]",
    )}
>
    <div class="flex min-w-0 items-center gap-1 justify-self-start">
        {#if view.showBack}
            <Button
                variant="ghost"
                disabled={view.backDisabled}
                onclick={onBack}
                aria-label="Previous problem"
                class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto [&_svg]:size-3.5 disabled:opacity-30"
            >
                <Icon name="arrow_back" />
            </Button>
        {/if}
        {#if answerContributionAvailable}
            <Button
                variant="ghost"
                disabled={paused}
                onclick={onReport}
                aria-label="Report problem or suggest an answer"
                title="Report problem or suggest an answer"
                class={cn(
                    "h-auto px-2 py-1.5 text-xs font-normal text-muted-foreground hover:text-foreground [&_svg]:size-3.5 disabled:opacity-30",
                    submitted &&
                        "text-unsure hover:text-unsure",
                )}
                style="--attention-color: var(--color-unsure)"
            >
                <span
                    class:report-attention-icon={submitted}
                    class="flex"
                >
                    <Icon name="report" />
                </span>
            </Button>
        {/if}
        {#if view.showForward && !view.compact && view.mode !== "test"}
            <Button
                variant="ghost"
                disabled={view.forwardDisabled}
                onclick={isLatest ? onSkip : onForward}
                aria-label={isLatest ? "Skip Problem" : "Next Problem"}
                class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto [&_svg]:size-3.5 disabled:opacity-30"
            >
                <Icon name={isLatest ? "skip_next" : "arrow_forward"} />
            </Button>
        {/if}
    </div>

    {#if view.mode === "answering" && coachAvailable}
        <Button
            variant="outline"
            aria-pressed={coachMode}
            aria-label={coachMode
                ? "Switch to answer mode"
                : "Switch to Coach mode"}
            onclick={() => onToggleCoach?.()}
            class="h-9 gap-0.5 justify-self-center rounded-lg p-1 text-[11px] font-semibold"
            title={coachMode
                ? "Return to answer mode"
                : "Switch to Coach mode"}
        >
            <span
                class={cn(
                    "rounded-md px-2 py-1 transition-colors",
                    !coachMode &&
                        "bg-primary text-primary-foreground shadow-sm",
                )}
            >Answer</span>
            <span
                class={cn(
                    "rounded-md px-2 py-1 transition-colors",
                    coachMode && "bg-muted text-foreground",
                )}
            >Coach</span>
        </Button>
    {/if}

    <div class="col-start-3 flex min-w-0 items-center gap-2 justify-self-end">
        {#if view.mode === "test"}
            {#if segmented}
                {#if canSegmentForward}
                    <Button
                        variant="ghost"
                        onclick={onForward}
                        disabled={paused}
                        aria-label="Next problem"
                        class="text-muted-foreground hover:text-foreground font-normal text-xs px-2.5 py-1.5 h-auto gap-1 [&_svg]:size-3.5 disabled:opacity-30"
                    >
                        <Icon name="arrow_forward" />
                    </Button>
                {/if}
                {#if revealMode}
                    <!-- Countdown reveal: first press grades this problem in place;
                         the next continues past the revealed result. -->
                    <Button
                        variant="primary"
                        onclick={() => onAdvanceSegment?.()}
                        disabled={submittingTest || paused}
                        class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                    >
                        {#if !segmentRevealed}
                            Submit
                        {:else if lastSegment}
                            <Icon name="done_all" />
                            Finish test
                        {:else}
                            Next problem
                            <Icon name="arrow_forward" />
                        {/if}
                    </Button>
                {:else if lastSegment}
                    <Button
                        variant="primary"
                        onclick={onSubmitTest}
                        disabled={submittingTest || paused}
                        class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                    >
                        <Icon name="done_all" />
                        Submit test
                    </Button>
                {:else}
                    <Button
                        variant="primary"
                        onclick={() => onAdvanceSegment?.()}
                        disabled={submittingTest || paused}
                        class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                    >
                        Submit &amp; continue
                        <Icon name="arrow_forward" />
                    </Button>
                {/if}
            {:else if !isLatest}
                <Button
                    variant="primary"
                    onclick={onForward}
                    disabled={paused}
                    class="h-9 gap-1.5 px-4 text-xs font-semibold"
                >
                    Next problem
                    <Icon name="arrow_forward" />
                </Button>
            {:else}
                <Button
                    variant="primary"
                    onclick={onSubmitTest}
                    disabled={submittingTest || paused}
                    class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                >
                    <Icon name="done_all" />
                    Submit test
                </Button>
            {/if}
        {:else if view.mode === "historical"}
            <Button
                variant="outline"
                onclick={onJumpToLatest}
                disabled={paused}
                class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
            >
                Latest
                <Icon name="last_page" />
            </Button>
        {:else if view.mode === "submitted"}
            <span
                transition:fade={{ duration: 150 }}
                class={cn(
                    "type-caption text-muted-foreground",
                    correct === true && "text-correct",
                    correct === false && "text-destructive",
                )}
            >
                {correct === true ? "Correct" : correct === false ? "Incorrect" : "Recorded"}{#if playerRating && ratingDelta !== null}
                    <span class="font-mono tabular-nums text-muted-foreground">
                        · Rating {Math.round(playerRating.rating)} ({ratingDelta >= 0 ? "+" : ""}{Math.round(ratingDelta)})
                    </span>
                {/if}
            </span>
            <Button
                variant="primary"
                onclick={onLoadProblem}
                class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
            >
                Next
                <Icon name="arrow_forward" />
            </Button>
        {:else}
            {#if isLatest && hasAnswer && triesUsed > 0 && triesPerProblem > 1}
                <span
                    class="text-[11px] text-muted-foreground tabular-nums"
                    title="Attempts remaining on this problem"
                >
                    {triesRemaining}
                    {triesRemaining === 1 ? "try" : "tries"} left
                </span>
            {/if}

            <Button
                variant="primary"
                disabled={cannotSubmit}
                onclick={onSubmitAnswer}
                class="text-xs font-semibold px-4 py-2 h-9 rounded-lg"
            >
                Submit
            </Button>
        {/if}
    </div>
</footer>

<style>
    @keyframes report-icon-attention {
        0%,
        100% {
            transform: scale(1);
            text-shadow: 0 0 0 transparent;
        }
        45% {
            transform: scale(1.16);
            text-shadow: 0 0 0.45rem
                color-mix(in oklab, var(--attention-color) 55%, transparent);
        }
    }

    .report-attention-icon {
        transform-origin: center;
        animation: report-icon-attention 2.4s ease-in-out infinite;
    }

    @media (prefers-reduced-motion: reduce) {
        .report-attention-icon {
            animation: none;
        }
    }
</style>
