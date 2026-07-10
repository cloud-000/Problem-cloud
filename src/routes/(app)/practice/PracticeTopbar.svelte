<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { RatingCounter } from "$lib/components/rating-counter";
    import { RatingLifeBar } from "$lib/components/rating-life-bar";
    import { SegmentBar } from "$lib/components/segment-bar";
    import { TopbarRegister } from "$lib/components/topbar";
    import { resolve } from "$app/paths";
    import type { PlayerRating } from "$lib/library";
    import { cn, formatElapsed } from "$lib/utils";

    export type RatingBarHandle = { settle: () => void };

    let {
        sessionName,
        isTest,
        showSettings,
        playerRating,
        ratingBar = $bindable<RatingBarHandle | undefined>(),
        showLiveFeedback,
        focusModeActive,
        correctAttempts,
        incorrectAttempts,
        skippedAttempts,
        testFinished,
        historyLength,
        timeLimitSeconds,
        remainingMs,
        totalElapsedMs,
        problemVisible,
        loading,
        allowPause,
        submitted,
        isLatest,
        paused,
        timerMode = $bindable<"problem" | "total">(),
        elapsedMs,
        onToggleSettings,
        onTogglePause,
    }: {
        sessionName: string | null;
        isTest: boolean;
        showSettings: boolean;
        playerRating: PlayerRating | null;
        ratingBar?: RatingBarHandle;
        showLiveFeedback: boolean;
        focusModeActive: boolean;
        correctAttempts: number;
        incorrectAttempts: number;
        skippedAttempts: number;
        testFinished: boolean;
        historyLength: number;
        timeLimitSeconds: number | null;
        remainingMs: number | null;
        totalElapsedMs: number;
        problemVisible: boolean;
        loading: boolean;
        allowPause: boolean;
        submitted: boolean;
        isLatest: boolean;
        paused: boolean;
        timerMode: "problem" | "total";
        elapsedMs: number;
        onToggleSettings: () => void;
        onTogglePause: () => void;
    } = $props();

    const iconCls = "size-[1em] shrink-0 leading-none opacity-70";
</script>

<TopbarRegister left={topbarLeft} right={topbarRight} />

{#snippet topbarLeft()}
    <div class="flex items-center gap-2 flex-1 min-w-0">
        <a
            href={resolve("/practice")}
            class="inline-flex items-center rounded-md h-8 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Back to sessions"
        >
            <Icon name="arrow_back" class={iconCls} />
        </a>
        <Button
            variant="ghost"
            size="sm"
            class={cn(
                "text-muted-foreground hover:text-foreground text-xs font-normal gap-1.5 px-2.5 shrink-0",
                showSettings && "bg-muted text-foreground",
            )}
            onclick={onToggleSettings}
            aria-expanded={showSettings}
            aria-label="Toggle settings"
        >
            <Icon name="tune" class={iconCls} />
        </Button>
        {#if sessionName || isTest}
            <div class="flex flex-row items-center gap-1.5 shrink-0">
                {#if isTest}
                    <span class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        <Icon name="quiz" class="size-[1em]" />
                        Test
                    </span>
                {/if}
                {#if sessionName}
                    <span class="opacity-50 text-xs truncate max-w-24 sm:max-w-40">{sessionName}</span>
                {/if}
            </div>
        {/if}
        {#if playerRating}
            <div class="flex items-center text-xs text-muted-foreground/50 gap-1.5 min-w-0 flex-1">
                <RatingCounter value={playerRating.rating} class="text-foreground font-medium" />
                <RatingLifeBar
                    bind:this={ratingBar}
                    {playerRating}
                    tierSize={200}
                    class="h-2 w-full min-w-0"
                />
            </div>
        {/if}
    </div>
{/snippet}

{#snippet topbarRight()}
    <div class="flex items-center gap-2 min-w-0 flex-1">
        {#if showLiveFeedback && !focusModeActive}
            <SegmentBar
                class="min-w-15 w-full h-2"
                segments={[
                    { value: correctAttempts, color: "var(--color-correct)", label: "Solved" },
                    { value: incorrectAttempts, color: "var(--color-destructive)", label: "Incorrect" },
                    { value: skippedAttempts, color: "var(--color-unsure)", label: "Skipped" },
                ]}
            />
        {/if}
        {#if isTest}
            {#if !testFinished && historyLength > 0}
                {@const timed = timeLimitSeconds != null}
                {@const low = timed && remainingMs != null && remainingMs <= 60_000}
                {@const displayMs = timed ? (remainingMs ?? 0) : totalElapsedMs}
                <div
                    class={cn(
                        "inline-flex h-8 items-center justify-center rounded-md",
                        focusModeActive ? "w-8 px-0" : "gap-1.5 px-2.5",
                        low ? "bg-destructive/15 text-destructive" : "bg-surface-container-low",
                    )}
                    title={`${timed ? "Time remaining" : "Elapsed time"}: ${formatElapsed(displayMs)}`}
                    aria-label={timed ? "Time remaining" : "Elapsed time"}
                >
                    {#if !focusModeActive}
                        <Icon name={timed ? "timer" : "schedule"} class={iconCls} />
                    {/if}
                    <span class={cn("leading-none tabular-nums font-mono", !focusModeActive && "min-w-[5ch] text-center")}>
                        {formatElapsed(displayMs)}
                    </span>
                </div>
            {/if}
        {:else if problemVisible || loading}
            {@const isTotal = timerMode === "total"}
            {@const displayMs = isTotal ? totalElapsedMs : elapsedMs}
            <div class="flex items-center gap-1.5">
                {#if allowPause}
                    <div class="size-8 shrink-0">
                        {#if !submitted && isLatest}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                class="text-muted-foreground hover:text-foreground"
                                onclick={onTogglePause}
                                aria-label={paused ? "Resume practice" : "Pause practice"}
                                title={paused ? "Resume" : "Pause"}
                            >
                                <Icon name={paused ? "play_arrow" : "pause"} class={iconCls} />
                            </Button>
                        {/if}
                    </div>
                {/if}
                <button
                    type="button"
                    onclick={() => (timerMode = isTotal ? "problem" : "total")}
                    class={cn(
                        "inline-flex h-8 items-center justify-center rounded-md bg-surface-container-low transition-colors hover:bg-surface-container",
                        focusModeActive ? "w-8 px-0" : "gap-1 px-2.5",
                    )}
                    title={isTotal
                        ? `Total session time: ${formatElapsed(displayMs)} — click for this problem`
                        : `Time on this problem: ${formatElapsed(displayMs)} — click for session total`}
                    aria-label={isTotal ? "Total session time" : "Time on this problem"}
                >
                    {#if !focusModeActive}
                        <Icon name={isTotal ? "timelapse" : "schedule"} class={iconCls} />
                    {/if}
                    <span class={cn("leading-none tabular-nums font-mono", !focusModeActive && "min-w-[5ch] text-center")}>
                        {formatElapsed(displayMs)}
                    </span>
                </button>
            </div>
        {/if}
    </div>
{/snippet}
