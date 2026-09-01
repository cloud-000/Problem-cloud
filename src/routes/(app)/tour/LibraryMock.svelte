<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import * as Subtabs from "$lib/components/subtabs";
    import { cn } from "$lib/utils";

    type Tab = "problems" | "tests" | "series";

    const tabs: { value: Tab; label: string }[] = [
        { value: "problems", label: "Problems" },
        { value: "tests", label: "Tests" },
        { value: "series", label: "Series" },
    ];

    const catalog: Record<
        Tab,
        { title: string; meta: string; hint: string }[]
    > = {
        problems: [
            {
                title: "AMC 10A 2024 #12",
                meta: "Algebra · 2024",
                hint: "A single problem you can open or practice.",
            },
            {
                title: "AIME I 2023 #4",
                meta: "Number theory · 2023",
                hint: "A single problem you can open or practice.",
            },
            {
                title: "AMC 12B 2023 #18",
                meta: "Geometry · 2023",
                hint: "A single problem you can open or practice.",
            },
        ],
        tests: [
            {
                title: "AMC 10A 2024",
                meta: "AMC 10 · 25 problems",
                hint: "A full contest sitting, in order.",
            },
            {
                title: "AIME I 2024",
                meta: "AIME · 15 problems",
                hint: "A full contest sitting, in order.",
            },
            {
                title: "AMC 12B 2023",
                meta: "AMC 12 · 25 problems",
                hint: "A full contest sitting, in order.",
            },
        ],
        series: [
            {
                title: "AMC 10",
                meta: "Official series",
                hint: "Every year of a competition, in one place.",
            },
            {
                title: "AIME",
                meta: "Official series",
                hint: "Every year of a competition, in one place.",
            },
            {
                title: "AHSME",
                meta: "Official series",
                hint: "Every year of a competition, in one place.",
            },
        ],
    };

    let tab = $state("problems");
    let query = $state("");
    let selected = $state<string | null>(null);

    function isTab(value: string): value is Tab {
        return value === "problems" || value === "tests" || value === "series";
    }
    let activeTab = $derived(isTab(tab) ? tab : "problems");

    let rows = $derived.by(() => {
        const needle = query.trim().toLowerCase();
        const items = catalog[activeTab];
        if (!needle) return items;
        return items.filter((item) => item.title.toLowerCase().includes(needle));
    });
    let caption = $derived(
        catalog[activeTab].find((item) => item.title === selected)?.hint ??
            (activeTab === "problems"
                ? "One problem at a time."
                : activeTab === "tests"
                  ? "A whole contest."
                  : "A competition across years."),
    );
</script>

<div
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest"
>
    <label class="relative border-b border-border px-3 py-2.5">
        <span class="sr-only">Search this sample Library</span>
        <Icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-5 z-10 -translate-y-1/2 text-muted-foreground"
        />
        <Input
            bind:value={query}
            placeholder={activeTab === "problems"
                ? "Search by problem ID"
                : `Search ${activeTab} by name`}
            class="h-9 pl-10 shadow-none"
        />
    </label>

    <Subtabs.Root
        bind:value={tab}
        onchange={() => {
            selected = null;
        }}
        class="min-h-0 flex-1 gap-0"
    >
        <div class="flex min-w-0 items-end border-b border-border px-3">
            <Subtabs.List class="min-w-0 flex-1 gap-4 border-b-0 sm:gap-6">
                {#each tabs as item (item.value)}
                    <Subtabs.Trigger value={item.value}>{item.label}</Subtabs.Trigger>
                {/each}
            </Subtabs.List>
            <span class="pb-2 type-caption text-muted-foreground">
                {rows.length} result{rows.length === 1 ? "" : "s"}
            </span>
        </div>

        {#each tabs as item (item.value)}
            <Subtabs.Content
                value={item.value}
                class="min-h-0 flex-1 overflow-y-auto rounded-none px-1"
            >
                {#if rows.length === 0}
                    <p class="px-3 py-6 type-caption text-muted-foreground">
                        Nothing in this sample matches.
                    </p>
                {:else}
                    <ul>
                        {#each rows as row (row.title)}
                            <li>
                                <button
                                    type="button"
                                    class={cn(
                                        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                        selected === row.title && "bg-muted/60",
                                    )}
                                    aria-pressed={selected === row.title}
                                    onclick={() =>
                                        (selected =
                                            selected === row.title ? null : row.title)}
                                >
                                    <span class="min-w-0 flex-1">
                                        <span class="block type-body font-semibold text-foreground">
                                            {row.title}
                                        </span>
                                        <span class="mt-0.5 block type-caption text-muted-foreground">
                                            {row.meta}
                                        </span>
                                    </span>
                                    <Icon
                                        name="chevron_right"
                                        class="shrink-0 text-muted-foreground"
                                    />
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </Subtabs.Content>
        {/each}
    </Subtabs.Root>

    <p class="border-t border-border px-3 py-2 type-caption text-muted-foreground">
        {caption}
    </p>
</div>
