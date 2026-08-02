<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import { cn, type WithElementRef } from "$lib/utils";

    type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        children?: Snippet;
        sticky?: boolean;
    };

    let {
        ref = $bindable(null),
        sticky = false,
        children,
        class: className,
        ...restProps
    }: Props = $props();
</script>

<div
    bind:this={ref}
    data-slot="page-toolbar"
    data-sticky={sticky}
    class={cn(
        "flex flex-wrap items-center gap-2",
        sticky &&
            "sticky top-0 z-20 border-b border-border bg-background py-3",
        className,
    )}
    {...restProps}
>
    {@render children?.()}
</div>
