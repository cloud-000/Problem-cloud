<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { useSidebar } from "./sidebar.svelte";

    type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        heading?: string;
    };

    let {
        ref = $bindable(null),
        class: className,
        heading,
        children,
        ...restProps
    }: Props = $props();

    const sidebar = useSidebar();
</script>

<div
    bind:this={ref}
    data-slot="sidebar-group"
    data-expanded={sidebar.expanded}
    class={cn(
        "flex flex-col gap-1 p-3 w-full transition-all duration-300",
        !sidebar.expanded && "items-center px-1.5",
        className
    )}
    {...restProps}
>
    {#if heading && sidebar.expanded}
        <div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none truncate w-full">
            {heading}
        </div>
    {/if}
    {@render children?.()}
</div>
