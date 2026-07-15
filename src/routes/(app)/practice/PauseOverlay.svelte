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
        onToggleTimerMode: () => void;
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
        onToggleTimerMode,
    }: Props = $props();

    let showingTotal = $derived(timerMode === "total");
    let displayedElapsedMs = $derived(showingTotal ? totalElapsedMs : elapsedMs);
</script>

<div
    class="absolute inset-0 z-20 flex items-center justify-center bg-background/85 px-4 py-8 backdrop-blur-(--backdrop-blur) select-none sm:px-8"
    transition:fade={{ duration: 150 }}
>
    <section
        class="flex w-full max-w-3xl flex-col gap-7 rounded-lg border border-border/70 bg-surface-container-lowest/95 p-6 text-left shadow-xl sm:p-8"
        aria-label="Practice paused"
    >
        <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex items-center gap-4">
                <div
                    class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                >
                    <Icon name="pause" fontsize={30} />
                </div>
                <div class="min-w-0">
                    <h2 class="text-xl font-semibold text-foreground">
                        Paused
                    </h2>

                </div>
            </div>
            <div
                class="w-fit rounded-lg bg-surface-container-low px-4 py-2 font-mono text-lg tabular-nums text-foreground"
            >
                {formatElapsed(displayedElapsedMs)}
            </div>
        </div>

        {#if !isTest}
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div
                    class="rounded-lg bg-surface-container-low px-4 py-4 text-center"
                >
                    <div
                        class="font-mono text-lg tabular-nums text-correct"
                    >
                        {correctAttempts}
                    </div>
                    <div class="text-xs text-muted-foreground">Correct</div>
                </div>
                <div
                    class="rounded-lg bg-surface-container-low px-4 py-4 text-center"
                >
                    <div
                        class="font-mono text-lg tabular-nums text-destructive"
                    >
                        {incorrectAttempts}
                    </div>
                    <div class="text-xs text-muted-foreground">Incorrect</div>
                </div>
                <div
                    class="rounded-lg bg-surface-container-low px-4 py-4 text-center"
                >
                    <div class="font-mono text-lg tabular-nums text-unsure">
                        {skippedAttempts}
                    </div>
                    <div class="text-xs text-muted-foreground">Skipped</div>
                </div>
            </div>
        {/if}

        <Button onclick={onResume} class="h-11 gap-2 text-sm font-semibold">
            <Icon name="play_arrow" />
            Resume
        </Button>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Button
                variant="outline"
                size="sm"
                onclick={onOpenSettings}
                class="h-10"
            >
                <Icon name="tune" />
                Settings
            </Button>
            <Button
                variant="outline"
                size="sm"
                onclick={onToggleTimerMode}
                class="h-10 gap-1"
            >
                <Icon name={showingTotal ? "schedule" : "timelapse"} />
                {showingTotal ? "Problem" : "Total"}
            </Button>
            <Button
                variant="outline"
                size="sm"
                onclick={onEndSession}
                disabled={!canEndSession || endingSession}
                class={cn("h-10", canEndSession && "text-destructive")}
            >
                <Icon name={endingSession ? "progress_activity" : "stop"} />
                End
            </Button>
        </div>
    </section>
</div>
