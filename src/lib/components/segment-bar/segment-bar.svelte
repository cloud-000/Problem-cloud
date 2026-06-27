<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";

    /** One proportional section of the bar. `color` is any CSS color string. */
    export type Segment = { value: number; color: string; label?: string };

    let {
        segments,
        class: className,
        ...restProps
    }: {
        segments: Segment[];
    } & HTMLAttributes<HTMLDivElement> = $props();

    let total = $derived(segments.reduce((sum, s) => sum + s.value, 0));
</script>

<div
    class={cn(
        "flex h-2 w-full overflow-hidden rounded-full bg-surface-container",
        className,
    )}
    {...restProps}
>
    {#if total > 0}
        {#each segments as { value, color, label } (label ?? color)}
            {#if value > 0}
                <div
                    class="h-full"
                    style="width: {(value / total) * 100}%; background-color: {color}"
                    title={label}
                ></div>
            {/if}
        {/each}
    {/if}
</div>
