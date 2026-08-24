<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import { cn, type WithElementRef } from "$lib/utils";

    type Props = WithElementRef<HTMLAttributes<HTMLElement>> & {
        title?: string;
        description?: string;
        actions?: Snippet;
        children?: Snippet;
    };

    let {
        ref = $bindable(null),
        title,
        description,
        actions,
        children,
        class: className,
        id,
        ...restProps
    }: Props = $props();

    const uid = $props.id();
    const titleId = `${uid}-title`;
</script>

<section
    bind:this={ref}
    data-slot="page-section"
    {id}
    aria-labelledby={title ? titleId : undefined}
    class={cn("flex flex-col gap-4", id && "scroll-mt-6", className)}
    {...restProps}
>
    {#if title || description || actions}
        <div
            data-slot="page-section-header"
            class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
        >
            <div class="min-w-0">
                {#if title}
                    <h2 id={titleId} class="type-section-title text-foreground">
                        {#if id}
                            <a
                                href="#{id}"
                                class="text-inherit no-underline hover:underline decoration-border/80 underline-offset-4"
                            >
                                {title}
                            </a>
                        {:else}
                            {title}
                        {/if}
                    </h2>
                {/if}
                {#if description}
                    <p class="mt-1 type-secondary text-muted-foreground">
                        {description}
                    </p>
                {/if}
            </div>

            {#if actions}
                <div
                    data-slot="page-section-actions"
                    class="flex shrink-0 flex-wrap items-center gap-2"
                >
                    {@render actions()}
                </div>
            {/if}
        </div>
    {/if}

    {@render children?.()}
</section>
