<script lang="ts" module>
    export {
        skeletonVariants,
        type SkeletonRounded,
        type SkeletonProps,
    } from "./skeleton.js";
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { skeletonVariants, type SkeletonProps } from "./skeleton.js";

    let {
        class: className,
        rounded = "md",
        ref = $bindable(null),
        "aria-hidden": ariaHidden = "true",
        children,
        ...restProps
    }: SkeletonProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="skeleton-root"
    aria-hidden={ariaHidden}
    class={cn(skeletonVariants({ rounded }), className)}
    {...restProps}
>
    {@render children?.()}
</div>
