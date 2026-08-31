<script lang="ts">
    import type { PageData } from "./$types";
    import { onMount } from "svelte";
    import { page as pageStore } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import * as Page from "$lib/components/page";
    import * as Subtabs from "$lib/components/subtabs";
    import type { Option } from "$lib/components/combobox";
    import {
        fetchSeries,
        fetchTests,
        fetchProblems,
        fetchAllSeries,
        LocalCatalogUnavailable,
        topicLabel,
        PAGE_SIZE,
        type Filters as FilterValues,
        type Level,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "$lib/library";
    import { LibraryStore } from "$lib/state/library.svelte";
    import Filters from "./Filters.svelte";
    import ResultList from "./ResultList.svelte";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase } = $derived(data);

    const store = new LibraryStore();
    const tabs: { value: Level; label: string }[] = [
        { value: "problems", label: "Problems" },
        { value: "tests", label: "Tests" },
        { value: "series", label: "Series" },
    ];

    // Seed the search filter from `?search=` (e.g. the home page's focused-series
    // worklist links to `/library?search=<problem id>`) so the linked-to problem
    // is actually surfaced. Read once at mount — the store owns the field after.
    onMount(() => {
        const search = pageStore.url.searchParams.get("search");
        if (search) store.patchFilters({ search });
    });

    let filtersOpen = $state(false);
    let pageRoot = $state<HTMLDivElement | null>(null);
    let filterAnchor = $state<HTMLDivElement | null>(null);
    let filterPanel = $state<HTMLElement | null>(null);
    let filterEditorKey = $state(0);
    let dockFilters = $state(false);
    let searchValue = $derived(store.current.filters.search ?? "");
    let searchPlaceholder = $derived(
        store.current.level === "problems"
            ? "Search by problem ID, e.g. 42, 108, 316"
            : `Search ${store.current.level} by name or ID`,
    );
    let searchHint = $derived(
        store.current.level === "problems" && searchValue.trim()
            ? "Problem search accepts one or more exact IDs. Use Filters to browse by topic, rating, or progress."
            : null,
    );
    let activeFilterCount = $derived.by(() => {
        const filters = store.current.filters;
        return Object.entries(filters).filter(([key, value]) => {
            if (
                key === "search" ||
                key === "name" ||
                (key === "seriesId" && store.current.context.series) ||
                (key === "testId" && store.current.context.test)
            )
                return false;
            if (value === undefined || value === null) return false;
            return !Array.isArray(value) || value.length > 0;
        }).length;
    });

    type FilterChip = { key: keyof FilterValues; label: string };
    let activeFilterChips = $derived.by<FilterChip[]>(() => {
        const filters = store.current.filters;
        const chips: FilterChip[] = [];
        const add = (key: keyof FilterValues, label: string, active = true) => {
            if (active) chips.push({ key, label });
        };
        const readable = (value: string) =>
            value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

        if (filters.seriesId != null && !store.current.context.series) {
            const series = seriesOptions.find(
                (option) =>
                    typeof option !== "string" &&
                    Number(option.value) === filters.seriesId,
            );
            add(
                "seriesId",
                `Series: ${typeof series === "string" ? series : (series?.label ?? filters.seriesId)}`,
            );
        }
        add(
            "topic",
            `Topics: ${filters.topic?.map((topic) => topicLabel(topic) ?? topic).join(", ")}`,
            Boolean(filters.topic?.length),
        );
        add("tags", `Tags: ${filters.tags?.join(", ")}`, Boolean(filters.tags?.length));
        add("year", `Years: ${filters.year?.[0]}–${filters.year?.[1]}`, Boolean(filters.year));
        add("type", `Types: ${filters.type?.join(", ")}`, Boolean(filters.type?.length));
        add(
            "difficulty",
            `Rating: ${filters.difficulty?.[0]}–${filters.difficulty?.[1]}`,
            Boolean(filters.difficulty),
        );
        add("quality", `Quality: ${filters.quality?.[0]}–${filters.quality?.[1]}`, Boolean(filters.quality));
        add(
            "mastery",
            `Mastery: ${filters.mastery?.map(readable).join(", ")}`,
            Boolean(filters.mastery?.length),
        );
        add(
            "engagement",
            `Plan: ${filters.engagement?.map(readable).join(", ")}`,
            Boolean(filters.engagement?.length),
        );
        if (filters.isOfficial != null)
            add("isOfficial", filters.isOfficial ? "Official" : "Not official");
        if (filters.isComputational != null)
            add(
                "isComputational",
                filters.isComputational ? "Computational" : "Not computational",
            );
        if (filters.verified != null)
            add("verified", filters.verified ? "Verified" : "Not verified");
        return chips;
    });

    // Series options for the filter comboboxes, fetched once.
    let seriesOptions = $state<Option[]>([]);
    $effect(() => {
        fetchAllSeries(supabase).then((rows) => {
            seriesOptions = rows.map((row) => ({
                value: String(row.id),
                label: row.name,
            }));
        });
    });

    let results = $state<(SeriesRow | TestRow | ProblemRow)[]>([]);
    let resultsLevel = $state<Level | null>(null);
    let loading = $state(false);
    let loadingMore = $state(false);
    let hasMore = $state(false);
    let errorMsg = $state<string | null>(null);
    let errorRetryable = $state(true);
    let queryKey = $state(0);
    let retryKey = $state(0);

    // Latest-loaded page index and a token that discards stale responses.
    let page = 0;
    let token = 0;

    function fetchPage(level: Level, filters: FilterValues, pageNum: number) {
        return level === "series"
            ? fetchSeries(supabase, filters, pageNum)
            : level === "tests"
              ? fetchTests(supabase, filters, pageNum)
              : fetchProblems(supabase, filters, pageNum);
    }

    function updateSearch(event: Event) {
        store.patchFilters({
            search: (event.currentTarget as HTMLInputElement).value || undefined,
        });
    }

    function closeFilters() {
        filtersOpen = false;
    }

    function handleFilterPointerdown(event: PointerEvent) {
        if (
            filtersOpen &&
            !dockFilters &&
            filterAnchor &&
            !filterAnchor.contains(event.target as Node)
        ) {
            closeFilters();
        }
    }

    function handleFilterKeydown(event: KeyboardEvent) {
        if (filtersOpen && event.key === "Escape") {
            event.preventDefault();
            closeFilters();
        }
    }

    function removeFilter(key: keyof FilterValues) {
        store.patchFilters({ [key]: undefined } as FilterValues);
        filterEditorKey += 1;
    }

    function removeScope(scope: "series" | "test") {
        store.clearScope(scope);
        filterEditorKey += 1;
    }

    function clearFilters() {
        store.clearFilters();
        filterEditorKey += 1;
    }

    $effect(() => {
        if (!filtersOpen) return;
        queueMicrotask(() => filterPanel?.focus({ preventScroll: true }));
    });

    $effect(() => {
        const root = pageRoot;
        if (!root) return;

        const observer = new ResizeObserver(([entry]) => {
            dockFilters = (entry?.contentRect.width ?? root.clientWidth) >= 1152;
        });
        observer.observe(root);
        return () => observer.disconnect();
    });

    $effect(() => {
        const frame = store.current;
        const readMode = offlineMode.effective;
        retryKey;
        const level = frame.level;
        const snapshot = $state.snapshot(frame.filters);

        const myToken = ++token;
        queryKey = myToken;
        results = [];
        resultsLevel = null;
        page = 0;
        hasMore = false;
        loadingMore = false;
        loading = true;
        const timer = setTimeout(async () => {
            try {
                const data = await fetchPage(level, snapshot, 0);
                if (myToken === token) {
                    resultsLevel = level;
                    results = data;
                    page = 0;
                    hasMore = data.length === PAGE_SIZE;
                    errorMsg = null;
                    errorRetryable = true;
                }
            } catch (error) {
                if (myToken === token) {
                    if (readMode === "online") offlineMode.noteRemoteFailure();
                    errorMsg = (error as Error).message;
                    errorRetryable = !(error instanceof LocalCatalogUnavailable);
                }
            } finally {
                if (myToken === token) loading = false;
            }
        }, 250);

        return () => clearTimeout(timer);
    });

    async function loadMore() {
        if (loading || loadingMore || !hasMore) return;
        const frame = store.current;
        const level = frame.level;
        const snapshot = $state.snapshot(frame.filters);
        const myToken = token;
        loadingMore = true;
        try {
            const next = await fetchPage(level, snapshot, page + 1);
            if (myToken === token) {
                results = [...results, ...next];
                page += 1;
                hasMore = next.length === PAGE_SIZE;
            }
        } catch (error) {
            if (myToken === token) errorMsg = (error as Error).message;
        } finally {
            if (myToken === token) loadingMore = false;
        }
    }
</script>

{#snippet filterContents(showDone: boolean)}
    <div class="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
            <h2 id="library-filters-title" class="type-section-title text-foreground">
                Filters
            </h2>
            <p class="mt-0.5 type-caption text-muted-foreground">
                Refine the current {store.current.level} view.
            </p>
        </div>
        <div class="flex items-center gap-1">
            <Button
                variant="ghost"
                size="sm"
                disabled={activeFilterCount === 0}
                onclick={clearFilters}
            >
                Clear
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close filters"
                onclick={closeFilters}
            >
                <Icon name="close" />
            </Button>
        </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {#key `${store.cursor}:${filterEditorKey}`}
            <Filters {store} {seriesOptions} />
        {/key}
    </div>

    {#if showDone}
        <div class="border-t border-border px-4 py-3">
            <Button class="w-full" onclick={closeFilters}>Done</Button>
        </div>
    {/if}
{/snippet}

<svelte:window
    onpointerdown={handleFilterPointerdown}
    onkeydown={handleFilterKeydown}
/>

<svelte:head>
    <title>Library · ProblemCloud</title>
</svelte:head>

<Page.Root bind:ref={pageRoot} width="unbounded" class="gap-0">
    <Page.Header
        title="Library"
        description="Search the collection, explore competition archives, and choose what to practice next."
        class="mb-8"
    />

    {#if offlineMode.lastLocalRead || offlineMode.effective === "local"}
        <div class="mb-4 rounded-lg border border-border bg-surface-container-low px-4 py-3 type-secondary" role="status">
            <span class="font-medium">Showing downloaded content.</span>
            Results, counts, rating filters, and empty states describe this device’s downloaded subset; ratings are frozen at download time.
        </div>
    {/if}

    <Page.Toolbar
        sticky
        class="-mx-4 items-stretch px-4 sm:-mx-6 sm:flex-nowrap sm:px-6 lg:-mx-8 lg:px-8"
    >
        <label class="relative min-w-0 flex-1">
            <span class="sr-only">Search Library</span>
            <Icon
                name="search"
                class="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-muted-foreground"
            />
            <Input
                value={searchValue}
                oninput={updateSearch}
                placeholder={searchPlaceholder}
                class="h-10 pl-10 type-body shadow-none"
            />
        </label>
        <div bind:this={filterAnchor} class="relative flex shrink-0">
            <Button
                variant="outline"
                size="lg"
                aria-haspopup={dockFilters ? undefined : "dialog"}
                aria-expanded={filtersOpen}
                aria-controls="library-filters"
                onclick={() => (filtersOpen = !filtersOpen)}
            >
                <Icon name="tune" />
                Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </Button>

            {#if filtersOpen && !dockFilters}
                <button
                    type="button"
                    class="fixed inset-0 z-40 bg-background/55 backdrop-blur-xs sm:hidden"
                    aria-label="Close filters"
                    onclick={closeFilters}
                ></button>
                <div
                    bind:this={filterPanel}
                    id="library-filters"
                    role="dialog"
                    aria-labelledby="library-filters-title"
                    tabindex="-1"
                    class="fixed right-0 bottom-[calc(3.5rem+var(--safe-area-bottom))] left-0 z-50 flex max-h-[min(78vh,46rem)] flex-col rounded-t-xl border border-border bg-surface-container-lowest shadow-xl outline-none sm:absolute sm:top-[calc(100%+0.5rem)] sm:right-0 sm:bottom-auto sm:left-auto sm:w-[min(26rem,calc(100vw-3rem))] sm:rounded-xl"
                >
                    {@render filterContents(true)}
                </div>
            {/if}
        </div>
    </Page.Toolbar>

    {#if searchHint}
        <p class="mt-2 type-caption text-muted-foreground">
            {searchHint}
        </p>
    {/if}

    <Subtabs.Root
        value={store.current.level}
        onchange={(value) => store.setLevel(value as Level)}
        class="mt-8 gap-0"
    >
        <div class="flex min-w-0 items-end border-b border-border">
            <Subtabs.List
                class="min-w-0 flex-1 shrink gap-3 overflow-x-auto overflow-y-hidden border-b-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-6"
            >
                {#each tabs as tab (tab.value)}
                    <Subtabs.Trigger value={tab.value}>{tab.label}</Subtabs.Trigger>
                {/each}
            </Subtabs.List>

            <div class="flex shrink-0 items-center gap-1 pb-1.5 pl-2">
                {#if store.canBack || store.canForward}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="hidden sm:inline-flex"
                        disabled={!store.canBack}
                        onclick={() => store.back()}
                        aria-label="Back in Library"
                    >
                        <Icon name="arrow_back" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="hidden sm:inline-flex"
                        disabled={!store.canForward}
                        onclick={() => store.forward()}
                        aria-label="Forward in Library"
                    >
                        <Icon name="arrow_forward" />
                    </Button>
                {/if}
                <span class="min-w-16 text-right type-caption text-muted-foreground" aria-live="polite">
                    {#if loading}
                        Searching…
                    {:else}
                        {results.length}{hasMore ? "+" : ""} result{results.length === 1 && !hasMore ? "" : "s"}
                    {/if}
                </span>
            </div>
        </div>

        {#if store.current.context.series || store.current.context.test || activeFilterChips.length}
            <div class="flex flex-wrap items-center gap-1.5 border-b border-border py-3">
                {#if store.current.context.series}
                    <span class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-caption text-foreground">
                        {store.current.context.series.name}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${store.current.context.series.name} scope`}
                            onclick={() => removeScope("series")}
                        >
                            <Icon name="close" />
                        </Button>
                    </span>
                {/if}
                {#if store.current.context.test}
                    <span class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-caption text-foreground">
                        {store.current.context.test.name}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${store.current.context.test.name} scope`}
                            onclick={() => removeScope("test")}
                        >
                            <Icon name="close" />
                        </Button>
                    </span>
                {/if}
                {#each activeFilterChips as chip (chip.key)}
                    <span class="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 type-caption text-muted-foreground">
                        {chip.label}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${chip.label} filter`}
                            onclick={() => removeFilter(chip.key)}
                        >
                            <Icon name="close" />
                        </Button>
                    </span>
                {/each}
            </div>
        {/if}

        <div
            class={dockFilters && filtersOpen
                ? "grid min-w-0 grid-cols-[minmax(0,1fr)_26rem] items-start gap-8"
                : "min-w-0"}
        >
            <div class="min-w-0">
                {#key queryKey}
                    <ResultList
                        {store}
                        {results}
                        {resultsLevel}
                        {loading}
                        error={errorMsg}
                        isInstantFeedback
                        onEndReached={!loading && hasMore ? loadMore : undefined}
                        resetKey={queryKey}
                        onRetry={errorRetryable ? () => (retryKey += 1) : undefined}
                    />
                {/key}

                {#if loadingMore}
                    <div class="flex h-12 items-center justify-center type-secondary text-muted-foreground">
                        Loading more…
                    </div>
                {:else if !loading && results.length > 0 && !hasMore}
                    <div class="flex h-12 items-center justify-center type-caption text-muted-foreground">
                        End of results
                    </div>
                {/if}
            </div>

            {#if filtersOpen && dockFilters}
                <aside
                    bind:this={filterPanel}
                    id="library-filters"
                    aria-labelledby="library-filters-title"
                    tabindex="-1"
                    class="sticky top-[4.5rem] flex max-h-[calc(100dvh-6rem)] min-w-0 flex-col rounded-xl border border-border bg-surface-container-lowest shadow-sm outline-none"
                >
                    {@render filterContents(false)}
                </aside>
            {/if}
        </div>
    </Subtabs.Root>
</Page.Root>
