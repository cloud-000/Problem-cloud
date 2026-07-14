<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { cn, formatElapsed } from "$lib/utils";

    let {
        remainingMs,
        dangerMs = 10_000,
        icon = "timer",
        label = "Time remaining",
        compact = false,
        class: className,
    }: {
        /** Milliseconds left on the clock (already floored at 0 by the caller). */
        remainingMs: number;
        /** Turn the chip red at or below this many ms left. */
        dangerMs?: number;
        /** Material icon name; hidden when `compact`. */
        icon?: string;
        /** Accessible label / tooltip prefix. */
        label?: string;
        /** Icon-less, tighter chip (for cramped/focus layouts). */
        compact?: boolean;
        class?: string;
    } = $props();

    let low = $derived(remainingMs <= dangerMs);
    let display = $derived(formatElapsed(remainingMs));
</script>

<div
    class={cn(
        "inline-flex h-8 items-center justify-center rounded-md",
        compact ? "w-8 px-0" : "gap-1.5 px-2.5",
        low
            ? "bg-destructive/15 text-destructive"
            : "bg-surface-container-low",
        className,
    )}
    title={`${label}: ${display}`}
    aria-label={label}
>
    {#if !compact}
        <Icon name={icon} class="size-[1em] shrink-0 leading-none opacity-70" />
    {/if}
    <span
        class={cn(
            "leading-none tabular-nums font-mono",
            !compact && "min-w-[5ch] text-center",
        )}
    >
        {display}
    </span>
</div>
