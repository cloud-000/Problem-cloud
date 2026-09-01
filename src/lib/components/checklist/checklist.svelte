<script lang="ts" module>
    export type ChecklistItem = {
        id: string;
        label: string;
        done: boolean;
        href?: string;
    };
</script>

<script lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn, type WithElementRef } from "$lib/utils";

    let {
        items,
        title,
        ondismiss,
        ref = $bindable(null),
        class: className,
        ...restProps
    }: {
        items: ChecklistItem[];
        title?: string;
        ondismiss?: () => void;
        class?: string;
    } & WithElementRef<HTMLAttributes<HTMLElement>> = $props();

    const uid = $props.id();
    const titleId = `${uid}-title`;
    let completedCount = $derived(items.filter((item) => item.done).length);
    let total = $derived(items.length);
    let progressPct = $derived(total === 0 ? 0 : (completedCount / total) * 100);

    const rowClass =
        "flex items-center gap-3 rounded-lg px-2.5 py-2 type-secondary leading-none outline-none transition-colors";
</script>

{#snippet marker(done: boolean)}
    {#if done}
        <span
            class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-correct/15 text-correct"
            aria-hidden="true"
        >
            <Icon name="check" class="size-4" fontsize={16} opticalSize={20} fill />
        </span>
    {:else}
        <span
            class="size-5 shrink-0 rounded-md border border-border/80 bg-surface-container-lowest"
            aria-hidden="true"
        ></span>
    {/if}
{/snippet}

<section
    bind:this={ref}
    aria-labelledby={title ? titleId : undefined}
    class={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-xs sm:p-6",
        className,
    )}
    {...restProps}
>
    {#if title || ondismiss}
        <div class="flex items-start gap-3">
            {#if title}
                <div class="min-w-0 flex-1">
                    <div class="flex items-baseline justify-between gap-3">
                        <h2 id={titleId} class="type-section-title">{title}</h2>
                        <p class="shrink-0 type-caption tabular-nums text-muted-foreground">
                            {completedCount} of {total}
                        </p>
                    </div>
                    {#if total > 0}
                        <div
                            class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"
                            aria-hidden="true"
                        >
                            <div
                                class="h-full rounded-full bg-correct transition-[width] duration-300 ease-out"
                                style:width="{progressPct}%"
                            ></div>
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="min-w-0 flex-1"></div>
            {/if}
            {#if ondismiss}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={title ? `Dismiss ${title.toLowerCase()}` : "Dismiss"}
                    onclick={ondismiss}
                    class="-mt-0.5 shrink-0 text-muted-foreground"
                >
                    <Icon name="close" />
                </Button>
            {/if}
        </div>
    {/if}

    <ul class="flex flex-col gap-0.5">
        {#each items as item (item.id)}
            <li>
                {#if item.done}
                    <div class={cn(rowClass, "text-muted-foreground")}>
                        {@render marker(true)}
                        <span
                            class="min-w-0 flex-1 leading-none line-through decoration-[2.5px] [text-decoration-skip-ink:none] decoration-foreground/75"
                        >
                            {item.label}
                        </span>
                    </div>
                {:else if item.href}
                    <a
                        href={item.href}
                        class={cn(
                            rowClass,
                            "text-foreground hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-ring/50",
                        )}
                    >
                        {@render marker(false)}
                        <span class="min-w-0 flex-1 leading-none">{item.label}</span>
                    </a>
                {:else}
                    <div class={cn(rowClass, "text-foreground")}>
                        {@render marker(false)}
                        <span class="min-w-0 flex-1 leading-none">{item.label}</span>
                    </div>
                {/if}
            </li>
        {/each}
    </ul>
</section>
