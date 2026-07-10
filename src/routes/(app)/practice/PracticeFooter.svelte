<script lang="ts">
    import { Button } from "$lib/components/button";
    import { DropdownMenu, type DropdownOption } from "$lib/components/dropdown-menu";
    import { Icon } from "$lib/components/icon";
    import type { PlayerRating } from "$lib/library";
    import { cn } from "$lib/utils";
    import { fade } from "svelte/transition";
    import { deriveFooterViewState } from "./footer-state";

    let {
        gradeImmediately,
        isLatest,
        submitted,
        paused,
        focusModeActive,
        canGoBack,
        flagged,
        moreOptions,
        submittingTest,
        cannotSubmit,
        hasAnswer,
        triesUsed,
        triesPerProblem,
        triesRemaining,
        playerRating,
        ratingDelta,
        onBack,
        onForward,
        onJumpToLatest,
        onLoadProblem,
        onSubmitAnswer,
        onSubmitTest,
    }: {
        gradeImmediately: boolean;
        isLatest: boolean;
        submitted: boolean;
        paused: boolean;
        focusModeActive: boolean;
        canGoBack: boolean;
        flagged: boolean;
        moreOptions: DropdownOption[];
        submittingTest: boolean;
        cannotSubmit: boolean;
        hasAnswer: boolean;
        triesUsed: number;
        triesPerProblem: number;
        triesRemaining: number;
        playerRating: PlayerRating | null;
        ratingDelta: number | null;
        onBack: () => void;
        onForward: () => void;
        onJumpToLatest: () => void;
        onLoadProblem: () => void;
        onSubmitAnswer: () => void;
        onSubmitTest: () => void;
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
</script>

<footer class="sticky bottom-0 z-30 flex w-full items-center justify-between border-t border-border/50 bg-background/80 px-2 py-1">
    <div class="absolute inset-0 -z-10 bg-background/80 backdrop-blur-(--backdrop-blur) pointer-events-none"></div>
    <div class="flex items-center gap-1">
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
        <DropdownMenu options={moreOptions}>
            <Button
                variant="ghost"
                aria-label="More options"
                class={cn(
                    "font-normal text-xs px-2.5 py-1.5 h-auto [&_svg]:size-3.5",
                    flagged ? "text-unsure hover:text-unsure/80" : "text-muted-foreground hover:text-foreground",
                )}
            >
                <Icon name="more_horiz" />
            </Button>
        </DropdownMenu>
        {#if view.showForward && !view.compact && view.mode !== "test"}
            <Button
                variant="ghost"
                disabled={view.forwardDisabled}
                onclick={onForward}
                aria-label={isLatest ? "Skip problem" : "Next problem"}
                class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto gap-1 [&_svg]:size-3.5 disabled:opacity-30"
            >
                <Icon name={isLatest ? "skip_next" : "arrow_forward"} />
                {isLatest ? "Skip" : ""}
            </Button>
        {/if}
    </div>

    <div class="flex items-center gap-2">
        {#if view.mode === "test"}
            {#if !isLatest}
                <Button
                    variant="ghost"
                    onclick={onForward}
                    aria-label="Next problem"
                    class="text-muted-foreground hover:text-foreground font-normal text-xs px-2.5 py-1.5 h-auto gap-1 [&_svg]:size-3.5"
                >
                    <Icon name="arrow_forward" />
                </Button>
            {:else}
                <Button
                    onclick={onSubmitTest}
                    disabled={submittingTest}
                    class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
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
            {#if playerRating && ratingDelta !== null}
                <span
                    transition:fade={{ duration: 150 }}
                    class={cn(
                        "text-[11px] font-semibold tabular-nums",
                        ratingDelta > 0.5
                            ? "text-correct"
                            : ratingDelta < -0.5
                              ? "text-destructive"
                              : "text-muted-foreground",
                    )}
                    title="Your skill rating (change from this problem)"
                >
                    {Math.round(playerRating.rating)}
                    <span class="font-normal">({ratingDelta >= 0 ? "+" : ""}{Math.round(ratingDelta)})</span>
                </span>
            {/if}
            <Button
                onclick={onLoadProblem}
                class="bg-primary/90 text-primary-foreground hover:bg-primary text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
            >
                Next
                <Icon name="arrow_forward" />
            </Button>
        {:else}
            {#if isLatest && hasAnswer && triesUsed > 0 && triesPerProblem > 1}
                <span class="text-[11px] text-muted-foreground tabular-nums" title="Attempts remaining on this problem">
                    {triesRemaining} {triesRemaining === 1 ? "try" : "tries"} left
                </span>
            {/if}
            {#if view.compact}
                <Button
                    variant="ghost"
                    disabled={paused}
                    onclick={onForward}
                    class="text-muted-foreground hover:text-foreground text-xs font-semibold px-3 py-2 h-9 gap-1.5 rounded-lg disabled:opacity-30"
                >
                    <Icon name="skip_next" />
                    Skip
                </Button>
            {/if}
            <Button
                disabled={cannotSubmit}
                onclick={onSubmitAnswer}
                class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 shadow-sm rounded-lg"
            >
                Submit
            </Button>
        {/if}
    </div>
</footer>
