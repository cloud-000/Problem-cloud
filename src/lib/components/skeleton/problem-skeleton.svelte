<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import Skeleton from "./skeleton.svelte";

    export type ProblemSkeletonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        appearance?: "card" | "row";
        showHeader?: boolean;
        showChoices?: boolean;
        choicesCount?: number;
        showActions?: boolean;
    };

    let {
        appearance = "card",
        showHeader = true,
        showChoices = true,
        choicesCount = 5,
        showActions = true,
        class: className,
        ref = $bindable(null),
        ...restProps
    }: ProblemSkeletonProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="problem-skeleton"
    class={cn(
        appearance === "card"
            ? "rounded-lg border border-border bg-surface-container-lowest p-6 shadow-xs"
            : "border-b border-border/60 py-4",
        "flex flex-col gap-4",
        className,
    )}
    {...restProps}
>
    {#if showHeader}
        <!-- Header -->
        <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-2">
                <!-- Line 1: Number badge + Test title -->
                <div class="flex items-center gap-2">
                    <Skeleton class="h-5 w-10 rounded-md" />
                    <Skeleton class="h-5 w-40 rounded-sm" />
                </div>
                <!-- Line 2: Topic, rating, status tag pills -->
                <div class="flex items-center gap-2">
                    <Skeleton class="h-4 w-16 rounded-full" />
                    <Skeleton class="h-4 w-12 rounded-full" />
                    <Skeleton class="h-4 w-20 rounded-full" />
                </div>
            </div>

            {#if showActions}
                <!-- Action button stubs -->
                <div class="flex shrink-0 items-center gap-1.5">
                    <Skeleton class="size-7 rounded-md" />
                    <Skeleton class="size-7 rounded-md" />
                </div>
            {/if}
        </div>
    {/if}

    <!-- Problem statement lines -->
    <div class="space-y-2.5 py-1">
        <Skeleton class="h-4 w-full rounded-sm" />
        <Skeleton class="h-4 w-[93%] rounded-sm" />
        <Skeleton class="h-4 w-[76%] rounded-sm" />
    </div>

    <!-- MCQ options -->
    {#if showChoices}
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-2">
            {#each Array(choicesCount) as _, i (i)}
                <div class="flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-container-lowest p-2.5">
                    <Skeleton class="size-6 rounded-full shrink-0" />
                    <Skeleton class="h-4 w-16 rounded-sm" />
                </div>
            {/each}
        </div>
    {/if}
</div>
