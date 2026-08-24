<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { useSidebar } from "./sidebar.svelte";

    type Props = WithElementRef<HTMLAttributes<HTMLDivElement>>;

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: Props = $props();

    const sidebar = useSidebar();
</script>

<div
    bind:this={ref}
    data-slot="sidebar-header"
    data-expanded={sidebar.expanded}
    class={cn(
        "flex items-center gap-2 px-4 py-2 border-b border-border min-h-[48px] transition-all duration-300",
        !sidebar.expanded && "justify-center overflow-hidden px-2",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</div>
