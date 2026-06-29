<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { useSubtabs } from "./subtabs.svelte";

    export type SubtabsContentProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        value: string;
        keepMounted?: boolean;
    };

    let {
        ref = $bindable(null),
        value,
        keepMounted = false,
        class: className,
        children,
        ...restProps
    }: SubtabsContentProps = $props();

    const context = useSubtabs();
    const active = $derived(context.value === value);
</script>

{#if keepMounted}
    <div
        bind:this={ref}
        role="tabpanel"
        tabindex="0"
        hidden={!active}
        data-state={active ? "active" : "inactive"}
        class={cn(
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg w-full",
            !active && "hidden",
            className
        )}
        {...restProps}
    >
        {@render children?.()}
    </div>
{:else if active}
    <div
        bind:this={ref}
        role="tabpanel"
        tabindex="0"
        data-state="active"
        class={cn(
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg w-full",
            className
        )}
        {...restProps}
    >
        {@render children?.()}
    </div>
{/if}
