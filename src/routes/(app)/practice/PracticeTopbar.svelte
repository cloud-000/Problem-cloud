<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import {
        DropdownMenu,
        type DropdownOption,
    } from "$lib/components/dropdown-menu";
    import { Icon } from "$lib/components/icon";
    import { TopbarRegister } from "$lib/components/topbar";
    import { cn, formatElapsed } from "$lib/utils";

    let {
        sessionName,
        isTest,
        testFinished,
        historyIndex,
        historyLength,
        onOpenOverview,
        showTestClock = true,
        timeLimitSeconds,
        remainingMs,
        totalElapsedMs,
        problemVisible,
        loading,
        allowPause,
        submitted,
        isLatest,
        paused,
        elapsedMs,
        problemRemainingMs = null,
        segmentRemainingMs = null,
        focusModeActive,
        showWhiteboard,
        coachAvailable,
        showCoach,
        moreOptions,
        onToggleWhiteboard,
        onToggleCoach,
        onTogglePause,
    }: {
        sessionName: string | null;
        isTest: boolean;
        testFinished: boolean;
        historyIndex: number;
        historyLength: number;
        onOpenOverview?: () => void;
        showTestClock?: boolean;
        timeLimitSeconds: number | null;
        remainingMs: number | null;
        totalElapsedMs: number;
        problemVisible: boolean;
        loading: boolean;
        allowPause: boolean;
        submitted: boolean;
        isLatest: boolean;
        paused: boolean;
        elapsedMs: number;
        problemRemainingMs?: number | null;
        segmentRemainingMs?: number | null;
        focusModeActive: boolean;
        showWhiteboard: boolean;
        coachAvailable: boolean;
        showCoach: boolean;
        moreOptions: DropdownOption[];
        onToggleWhiteboard: () => void;
        onToggleCoach: () => void;
        onTogglePause: () => void;
    } = $props();

    const iconClass = "size-[1em] shrink-0 leading-none";

    let clockMs = $derived.by(() => {
        if (isTest) {
            if (!showTestClock) return segmentRemainingMs;
            return timeLimitSeconds == null ? totalElapsedMs : remainingMs;
        }
        return problemRemainingMs ?? elapsedMs;
    });
    let clockIsRemaining = $derived(
        isTest ? timeLimitSeconds != null || !showTestClock : problemRemainingMs != null,
    );
    let clockLabel = $derived(
        isTest
            ? showTestClock
                ? timeLimitSeconds == null
                    ? "Test elapsed time"
                    : "Test time remaining"
                : "Segment time remaining"
            : problemRemainingMs != null
              ? "Time remaining on this problem"
              : "Time on this problem",
    );
    let clockLow = $derived(
        clockIsRemaining && clockMs != null && clockMs <= (isTest ? 60_000 : 10_000),
    );
    let showClock = $derived(
        !testFinished && (loading || problemVisible) && (!isTest || historyLength > 0),
    );
    let canTogglePause = $derived(
        allowPause &&
            problemVisible &&
            !loading &&
            (isTest ? !testFinished : !submitted && isLatest),
    );
    let displayedTime = $derived(clockMs == null ? "--:--" : formatElapsed(clockMs));
    let timerAriaLabel = $derived(
        `${paused ? "Paused" : clockLabel}: ${displayedTime}${canTogglePause ? paused ? ". Resume practice" : ". Pause practice" : ""}`,
    );
</script>

<TopbarRegister left={contextLeft} right={contextRight} />

{#snippet contextLeft()}
    <div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <a
            href={resolve("/practice")}
            class="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back to Practice"
            title="Back to Practice"
        >
            <Icon name="arrow_back" class={iconClass} />
        </a>

        {#if !focusModeActive && sessionName}
            <span class="min-w-0 flex-1 truncate type-caption text-foreground sm:type-secondary">
                {sessionName}
            </span>
        {:else}
            <span class="min-w-0 flex-1"></span>
        {/if}

        {#if showClock}
            {#if canTogglePause}
                <button
                    type="button"
                    onclick={onTogglePause}
                    class={cn(
                        "group inline-flex h-10 shrink-0 items-center gap-1 rounded-md px-2 font-mono type-caption tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        clockLow ? "text-destructive" : "text-foreground",
                    )}
                    aria-label={timerAriaLabel}
                    title={paused ? "Resume practice" : `Pause practice · ${displayedTime}`}
                >
                    <span>{paused ? `Paused · ${displayedTime}` : displayedTime}</span>
                    <Icon
                        name={paused ? "play_arrow" : "pause"}
                        class="size-[0.9em] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                </button>
            {:else}
                <span
                    class={cn(
                        "inline-flex h-10 shrink-0 items-center px-2 font-mono type-caption tabular-nums",
                        clockLow ? "text-destructive" : "text-foreground",
                    )}
                    aria-label={timerAriaLabel}
                    title={`${clockLabel}: ${displayedTime}`}
                >
                    {paused ? `Paused · ${displayedTime}` : displayedTime}
                </span>
            {/if}
        {/if}

        {#if isTest && !testFinished && historyLength > 0}
            <button
                type="button"
                onclick={onOpenOverview}
                class="inline-flex h-10 shrink-0 items-center rounded-md px-2 type-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`View all problems. Problem ${historyIndex + 1} of ${historyLength}`}
                title="View all problems"
            >
                <span class="hidden sm:inline">Problem&nbsp;</span>{historyIndex + 1} of {historyLength}
            </button>
        {/if}
    </div>
{/snippet}

{#snippet contextRight()}
    <div class="flex shrink-0 items-center gap-1">
        {#if coachAvailable}
            <Button
                variant="ghost"
                size="icon-sm"
                class={cn(
                    "size-10 text-muted-foreground hover:text-foreground",
                    showCoach && "bg-muted text-foreground",
                )}
                onclick={onToggleCoach}
                aria-pressed={showCoach}
                aria-label={showCoach ? "Return to answer mode" : "Switch to Coach mode"}
                title={showCoach ? "Return to answer mode" : "Coach mode"}
            >
                <Icon name="auto_awesome" class={iconClass} fill={showCoach} />
            </Button>
        {/if}

        {#if problemVisible && !testFinished}
            <Button
                variant="ghost"
                size="icon-sm"
                class={cn(
                    "size-10 text-muted-foreground hover:text-foreground",
                    showWhiteboard && "bg-muted text-foreground",
                )}
                onclick={onToggleWhiteboard}
                disabled={paused}
                aria-expanded={showWhiteboard}
                aria-label="Toggle scratch paper"
                title={paused ? "Scratch paper is unavailable while paused" : "Scratch paper"}
            >
                <Icon name="draw" class={iconClass} fill={showWhiteboard} />
            </Button>
        {/if}

        <DropdownMenu options={moreOptions}>
            <Button
                variant="ghost"
                size="icon-sm"
                class="size-10 text-muted-foreground hover:text-foreground"
                aria-label="More Practice options"
                title="More options"
            >
                <Icon name="more_horiz" class={iconClass} />
            </Button>
        </DropdownMenu>
    </div>
{/snippet}
