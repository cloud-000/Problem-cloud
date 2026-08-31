<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { GettingStartedItem } from "$lib/onboarding";

    let {
        items,
        completedCount,
        total,
        ondismiss,
    }: {
        items: GettingStartedItem[];
        completedCount: number;
        total: number;
        ondismiss: () => void;
    } = $props();
</script>

<section
    aria-labelledby="getting-started-title"
    class="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 sm:p-6"
>
    <div class="flex items-start justify-between gap-3">
        <div>
            <h2 id="getting-started-title" class="type-section-title">
                Getting started
            </h2>
            <p class="mt-1 type-caption text-muted-foreground">
                {completedCount} of {total}
            </p>
        </div>
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss getting started"
            onclick={ondismiss}
            class="text-muted-foreground"
        >
            <Icon name="close" />
        </Button>
    </div>

    <ul class="flex flex-col gap-1">
        {#each items as item (item.id)}
            <li>
                {#if item.done}
                    <div
                        class="flex items-center gap-3 rounded-md px-2 py-2 type-secondary text-muted-foreground"
                    >
                        <Icon name="check" class="shrink-0 text-correct" />
                        <span class="line-through decoration-border">{item.label}</span>
                    </div>
                {:else}
                    <a
                        href={item.id === "set-goal"
                            ? resolve("/goals?new=1")
                            : resolve("/practice")}
                        class="flex items-center gap-3 rounded-md px-2 py-2 type-secondary text-foreground hover:bg-muted"
                    >
                        <span
                            class="size-4 shrink-0 rounded-full border border-border"
                            aria-hidden="true"
                        ></span>
                        <span>{item.label}</span>
                    </a>
                {/if}
            </li>
        {/each}
    </ul>
</section>
