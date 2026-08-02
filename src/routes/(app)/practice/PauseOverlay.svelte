<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn, formatElapsed } from "$lib/utils";
    import { fade } from "svelte/transition";

    type Props = {
        timeMs: number;
        canEndSession: boolean;
        endingSession: boolean;
        onResume: () => void;
        onOpenSettings: () => void;
        onEndSession: () => void;
    };

    let {
        timeMs,
        canEndSession,
        endingSession,
        onResume,
        onOpenSettings,
        onEndSession,
    }: Props = $props();

</script>

<div
    class="absolute inset-0 z-20 flex items-center justify-center bg-background/95 p-4 backdrop-blur-(--backdrop-blur) select-none"
    transition:fade={{ duration: 150 }}
>
    <section
        class="flex w-full max-w-sm flex-col items-center gap-5 text-center"
        aria-label="Practice paused"
    >
        <div>
            <h2 class="type-page-title text-foreground">Paused</h2>
            <p class="mt-2 font-mono text-lg tabular-nums text-muted-foreground">
                {formatElapsed(timeMs)}
            </p>
        </div>

        <Button
            variant="primary"
            onclick={onResume}
            class="min-w-40 gap-2"
        >
            <Icon name="play_arrow" />
            Resume practice
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
                End session
            </Button>
        </div>
    </section>
</div>
