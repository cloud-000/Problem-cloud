<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import { cn, type WithElementRef } from "$lib/utils";

    type Props = WithElementRef<HTMLAttributes<HTMLElement>> & {
        title: string;
        description?: string;
        eyebrow?: Snippet;
        actions?: Snippet;
    };

    let {
        ref = $bindable(null),
        title,
        description,
        eyebrow,
        actions,
        class: className,
        ...restProps
    }: Props = $props();
</script>

<header
    bind:this={ref}
    data-slot="page-header"
    class={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
    )}
    {...restProps}
>
    <div class="min-w-0 max-w-3xl">
        {#if eyebrow}
            <div class="mb-2 type-caption text-muted-foreground">
                {@render eyebrow()}
            </div>
        {/if}
        <h1 class="type-page-title text-foreground">{title}</h1>
        {#if description}
            <p class="mt-1 type-secondary text-muted-foreground">
                {description}
            </p>
        {/if}
    </div>

    {#if actions}
        <div
            data-slot="page-header-actions"
            class="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
        >
            {@render actions()}
        </div>
    {/if}
</header>
