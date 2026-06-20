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
    data-slot="sidebar-footer"
    data-expanded={sidebar.expanded}
    class={cn(
        "flex flex-col gap-2 p-4 border-t border-border mt-auto transition-all duration-300",
        !sidebar.expanded && "items-center px-2",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</div>
