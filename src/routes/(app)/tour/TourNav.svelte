<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { TOUR_NAV_ITEMS, type TourNavId } from "$lib/onboarding";
    import { cn } from "$lib/utils";

    let { active }: { active: TourNavId } = $props();
</script>

<nav
    aria-label="Where this lives"
    class="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-container-low py-3"
>
    {#each TOUR_NAV_ITEMS as item (item.id)}
        {@const isActive = item.id === active}
        <span
            class={cn(
                "flex size-10 items-center justify-center rounded-md",
                isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
        >
            <Icon name={item.icon} fill={isActive} />
            <span class="sr-only">{item.label}</span>
        </span>
    {/each}
</nav>
