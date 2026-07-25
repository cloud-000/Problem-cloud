<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn, formatElapsed } from "$lib/utils";
    import { fade } from "svelte/transition";

    type TimerMode = "problem" | "total";

    type Props = {
        elapsedMs: number;
        totalElapsedMs: number;
        timerMode: TimerMode;
        correctAttempts: number;
        incorrectAttempts: number;
        skippedAttempts: number;
        canEndSession: boolean;
        endingSession: boolean;
        /** Tests defer all grading, so the running outcome stats are hidden. */
        isTest?: boolean;
        onResume: () => void;
        onOpenSettings: () => void;
        onEndSession: () => void;
    };

    let {
        elapsedMs,
        totalElapsedMs,
        timerMode,
        correctAttempts,
        incorrectAttempts,
        skippedAttempts,
        canEndSession,
        endingSession,
        isTest = false,
        onResume,
        onOpenSettings,
        onEndSession,
    }: Props = $props();

    let showingTotal = $derived(timerMode === "total");
    let displayedElapsedMs = $derived(showingTotal ? totalElapsedMs : elapsedMs);
</script>

<div
    class="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-3 backdrop-blur-(--backdrop-blur) select-none sm:p-6"
    transition:fade={{ duration: 150 }}
>
    <section
        class="flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border/70 bg-surface-container-lowest/95 p-4 shadow-xl sm:p-5"
        aria-label="Practice paused"
    >
        <div class="flex flex-col items-center gap-2">
            <div
                class="font-mono text-base font-semibold tabular-nums text-foreground"
            >
                {formatElapsed(displayedElapsedMs)}
            </div>
        </div>

        {#if !isTest}
            <p
                class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                aria-label={`${correctAttempts} correct, ${incorrectAttempts} incorrect, ${skippedAttempts} skipped`}
            >
                <span><strong class="font-mono text-correct">{correctAttempts}</strong> correct</span>
                <span aria-hidden="true">·</span>
                <span><strong class="font-mono text-destructive">{incorrectAttempts}</strong> incorrect</span>
                <span aria-hidden="true">·</span>
                <span><strong class="font-mono text-unsure">{skippedAttempts}</strong> skipped</span>
            </p>
        {/if}

        <Button
            variant="primary"
            size="icon-lg"
            onclick={onResume}
            class="size-14 self-center rounded-full shadow-md"
            aria-label="Resume practice"
            title="Resume"
        >
            <Icon name="play_arrow" class="size-7" />
        </Button>

        <div class="flex items-center justify-center gap-1">
            <Button
                variant="ghost"
                size="sm"
                onclick={onOpenSettings}
                class="text-muted-foreground"
            >
                <Icon name="tune" />
                Settings
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onclick={onEndSession}
                disabled={!canEndSession || endingSession}
                class={cn(
                    "text-muted-foreground",
                    canEndSession && "text-destructive",
                )}
            >
                <Icon name={endingSession ? "progress_activity" : "stop"} />
                End
            </Button>
        </div>
    </section>
</div>
