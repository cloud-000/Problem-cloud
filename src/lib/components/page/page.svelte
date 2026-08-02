<script lang="ts" module>
    import type { HTMLAttributes } from "svelte/elements";
    import type { Snippet } from "svelte";
    import type { WithElementRef } from "$lib/utils";

    export type PageWidth = "narrow" | "standard" | "wide" | "unbounded";

    export type PageProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        width?: PageWidth;
        children?: Snippet;
    };

    export const pageWidthClasses: Record<PageWidth, string> = {
        narrow: "max-w-[760px]",
        standard: "max-w-[1040px]",
        wide: "max-w-[1280px]",
        unbounded: "max-w-none",
    };
</script>

<script lang="ts">
    import { cn } from "$lib/utils";

    let {
        ref = $bindable(null),
        width = "standard",
        class: className,
        children,
        ...restProps
    }: PageProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="page"
    data-width={width}
    class={cn(
        "mx-auto flex w-full flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
        pageWidthClasses[width],
        className,
    )}
    {...restProps}
>
    {@render children?.()}
</div>
