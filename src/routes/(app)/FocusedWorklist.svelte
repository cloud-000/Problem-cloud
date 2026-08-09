<script lang="ts">
    import { resolve } from "$app/paths";
    import { Icon } from "$lib/components/icon";
    import type { WorklistItem } from "$lib/home";

    let {
        items,
        seriesNames,
    }: {
        items: WorklistItem[];
        /** Series id -> name, for the trailing series badge. */
        seriesNames: Map<number, string>;
    } = $props();

    function problemTitle(item: WorklistItem) {
        const problem = item.problem;
        return `${problem.tests?.name ?? "Practice problem"} · Problem ${problem.n + 1}`;
    }

    function reasonLabel(item: WorklistItem) {
        return item.reason === "due" ? "Review due" : "Needs work";
    }

    function reasonIcon(item: WorklistItem) {
        return item.reason === "due" ? "schedule" : "warning";
    }

    function reasonClass(item: WorklistItem) {
        return item.reason === "due" ? "text-muted-foreground" : "text-destructive";
    }

    function href(item: WorklistItem) {
        return `${resolve("/library")}?search=${item.problem.id}`;
    }
</script>

{#if items.length > 0}
    <div class="divide-y divide-border border-y border-border">
        {#each items as item (item.problem.id)}
            <a
                href={href(item)}
                class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-3 transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
                <Icon name={reasonIcon(item)} class={reasonClass(item)} />
                <div class="min-w-0">
                    <p class="truncate type-secondary font-medium text-foreground">
                        {problemTitle(item)}
                    </p>
                    <span
                        class="mt-0.5 inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 type-caption text-foreground"
                    >
                        {seriesNames.get(item.seriesId) ?? "Series"}
                    </span>
                </div>
                <span
                    class="col-start-2 flex items-center gap-1 type-caption text-muted-foreground sm:col-start-3 sm:row-start-1"
                >
                    {reasonLabel(item)}
                </span>
            </a>
        {/each}
    </div>
{/if}
