<script lang="ts">
    import { Tween } from "svelte/motion";
    import { cubicOut } from "svelte/easing";
    import { untrack } from "svelte";
    import { fly, fade } from "svelte/transition";
    import { cn } from "$lib/utils";

    let { value, class: className }: { value: number; class?: string } =
        $props();

    const displayValue = new Tween(
        untrack(() => value),
        { duration: 1000, easing: cubicOut },
    );
    let delta = $state<number | null>(null);
    let showDelta = $state(false);
    let prevVal = $state(untrack(() => value));
    let deltaTimeout: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        if (value !== prevVal) {
            delta = value - prevVal;
            showDelta = true;
            displayValue.set(value);

            if (deltaTimeout) clearTimeout(deltaTimeout);
            deltaTimeout = setTimeout(() => {
                showDelta = false;
            }, 2000);

            prevVal = value;
        }
    });
</script>

<div class={cn("relative inline-flex items-center", className)}>
    <span class="tabular-nums font-mono font-semibold">
        {displayValue.current.toFixed(0)}
    </span>

    {#if showDelta && delta !== null}
        <span
            in:fly={{ y: 4, duration: 400 }}
            out:fade={{ duration: 200 }}
            class={cn(
                "absolute top-full left-1/2 -translate-x-1/2 font-mono text-xs pointer-events-none select-none mt-0.5 whitespace-nowrap",
                delta > 0 ? "text-correct" : "text-destructive",
            )}
        >
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}
        </span>
    {/if}
</div>
