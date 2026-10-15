<script lang="ts">
    import { cn } from "#lib/utils.js";
    import {
        skeletonVariants,
        type SkeletonProps,
    } from "./skeleton.js";

    let {
        effect = "shimmer",
        rounded,
        class: className,
        ref = $bindable(null),
        "aria-hidden": ariaHidden = "true",
        ...restProps
    }: SkeletonProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="skeleton-placeholder"
    aria-hidden={ariaHidden}
    class={cn(skeletonVariants({ rounded, effect }), className)}
    {...restProps}
></div>
