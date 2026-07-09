<script lang="ts">
    import { Tween } from "svelte/motion";
    import { cubicOut } from "svelte/easing";
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";
    import type { PlayerRating } from "$lib/library";

    let {
        playerRating,
        tierSize = 100,
        class: className,
    }: {
        playerRating: PlayerRating | null;
        tierSize?: number;
        class?: string;
    } = $props();

    let prevRating = $state<number | null>(
        untrack(() => playerRating?.rating ?? null),
    );
    const visualRating = new Tween(
        untrack(() => playerRating?.rating ?? 1500),
        { duration: 1500, easing: cubicOut },
    );
    const lingeringRating = new Tween(
        untrack(() => playerRating?.rating ?? 1500),
        { duration: 1000, easing: cubicOut },
    );

    let activeTrailingColor = $state("rgb(252, 186, 3)"); // Default to damage color
    let levelUpActive = $state(false);

    let delayTimeout: ReturnType<typeof setTimeout> | null = null;
    let levelUpTimeout: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        if (!playerRating) return;
        const currentVal = playerRating.rating;

        if (prevRating === null) {
            prevRating = currentVal;
            visualRating.set(currentVal, { duration: 0 });
            lingeringRating.set(currentVal, { duration: 0 });
            return;
        }

        if (currentVal !== prevRating) {
            const diff = currentVal - prevRating;

            if (delayTimeout) clearTimeout(delayTimeout);
            if (levelUpTimeout) clearTimeout(levelUpTimeout);

            if (diff < 0) {
                // Damage (Loss):
                // 1. Set color to damage (orange/yellow)
                activeTrailingColor = "var(--damage-color, rgb(252, 186, 3))";
                // 2. Snap fill instantly
                visualRating.set(currentVal, { duration: 0 });
                // 3. Keep trailing at prevRating, then decay it
                lingeringRating.set(prevRating, { duration: 0 });
                delayTimeout = setTimeout(() => {
                    lingeringRating.set(currentVal);
                }, 500);
            } else if (diff > 0) {
                // Healing (Gain):
                // 1. Set color to healing (green)
                activeTrailingColor = "var(--heal-color, rgb(50, 168, 82))";
                // 2. Snap trailing to target
                lingeringRating.set(currentVal, { duration: 0 });
                // 3. Tween actual fill from prevRating to currentVal
                visualRating.set(prevRating, { duration: 0 });
                visualRating.set(currentVal);

                // Level up check: crossed a multiple of tierSize
                if (
                    Math.floor(currentVal / tierSize) >
                    Math.floor(prevRating / tierSize)
                ) {
                    levelUpActive = true;
                    levelUpTimeout = setTimeout(() => {
                        levelUpActive = false;
                    }, 3000);
                }
            }

            prevRating = currentVal;
        }
    });

    // Finish any in-flight change animation immediately. The parent calls this
    // when navigating to another problem, so a slow tween/decay tail doesn't
    // bleed onto the next problem's screen after the user has moved on.
    export function settle() {
        if (!playerRating) return;
        const r = playerRating.rating;
        if (delayTimeout) {
            clearTimeout(delayTimeout);
            delayTimeout = null;
        }
        if (levelUpTimeout) {
            clearTimeout(levelUpTimeout);
            levelUpTimeout = null;
        }
        levelUpActive = false;
        visualRating.set(r, { duration: 0 });
        lingeringRating.set(r, { duration: 0 });
        prevRating = r;
    }

    // Derive percentages relative to current visual tier boundary
    let values = $derived.by(() => {
        const R_visual = visualRating.current;
        const R_linger = lingeringRating.current;
        const lower = Math.floor(R_visual / tierSize) * tierSize;

        const currentPercent = Math.max(
            0,
            Math.min(100, ((R_visual - lower) / tierSize) * 100),
        );
        const trailingPercent = Math.max(
            0,
            Math.min(100, ((R_linger - lower) / tierSize) * 100),
        );

        return {
            currentPercent,
            trailingPercent,
            lower,
            upper: lower + tierSize,
            rating: R_visual,
        };
    });
</script>

<div
    class={cn(
        "rating-life-bar-container relative flex-1 min-w-0 rounded-full overflow-hidden h-2 bg-surface-container transition-colors duration-300",
        levelUpActive && "glow-overtake",
        className,
    )}
    style="
        --fill-color: var(--color-primary-foreground);
        --damage-color: rgb(252, 186, 3);
        --heal-color: rgb(50, 168, 82);
    "
>
    <!-- Background layer is container itself -->

    <!-- Layer 2: Trailing Rect (middle) -->
    <div
        class="h-full absolute left-0 top-0 transition-colors duration-300"
        style="width: {values.trailingPercent}%; background-color: {activeTrailingColor};"
    ></div>

    <!-- Layer 3: Current Fill Rect (top) -->
    <div
        class="h-full absolute left-0 top-0"
        style="width: {values.currentPercent}%; background-color: var(--fill-color);"
    ></div>
</div>

<style>
    @keyframes overtake-pulse {
        0%,
        100% {
            box-shadow: 0 0 6px 1px var(--color-primary);
            border-color: var(--color-primary-foreground);
        }
        50% {
            box-shadow:
                0 0 16px 4px var(--color-primary),
                0 0 4px 1px var(--color-unsure);
            border-color: var(--color-correct);
        }
    }
    @keyframes shimmer {
        0% {
            background-position: -200% 0;
        }
        100% {
            background-position: 200% 0;
        }
    }
    .glow-overtake {
        position: relative;
        animation: overtake-pulse 2s infinite ease-in-out;
        border: 1.5px solid var(--color-primary) !important;
    }
    .glow-overtake::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2) 20%,
            rgba(255, 255, 255, 0.5) 40%,
            rgba(255, 255, 255, 0.2) 60%,
            transparent
        );
        background-size: 200% 100%;
        animation: shimmer 2.5s infinite linear;
        pointer-events: none;
    }
</style>
