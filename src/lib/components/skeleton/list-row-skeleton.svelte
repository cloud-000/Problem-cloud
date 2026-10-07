<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import Skeleton from "./skeleton.svelte";

    export type ListRowSkeletonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        showBadge?: boolean;
        showAction?: boolean;
    };

    let {
        showBadge = true,
        showAction = true,
        class: className,
        ref = $bindable(null),
        ...restProps
    }: ListRowSkeletonProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="list-row-skeleton"
    class={cn(
        "flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center",
        className,
    )}
    {...restProps}
>
    <div class="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton class="h-5 w-52 max-w-[80%] rounded-sm" />
        {#if showBadge}
            <div class="flex flex-wrap items-center gap-1.5">
                <Skeleton class="h-4 w-16 rounded-full" />
                <Skeleton class="h-4 w-20 rounded-full" />
                <Skeleton class="h-4 w-14 rounded-full" />
            </div>
        {/if}
    </div>

    {#if showAction}
        <div class="flex shrink-0 items-center gap-2">
            <Skeleton class="h-8 w-24 rounded-md" />
        </div>
    {/if}
</div>
