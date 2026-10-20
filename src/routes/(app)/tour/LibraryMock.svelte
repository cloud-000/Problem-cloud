<script lang="ts">
    import { page } from "$app/state";
    import { Button } from "#lib/components/button/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import { Input } from "#lib/components/input/index.js";
    import * as Subtabs from "#lib/components/subtabs/index.js";
    import { setAppScrollViewport } from "#lib/components/virtual-list/index.js";
    import {
        fetchProblems,
        fetchSeries,
        fetchTests,
        LocalCatalogUnavailable,
        PAGE_SIZE,
        type Filters,
        type Level,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "#lib/library.js";
    import {
        LIBRARY_MOCK_TABS,
        libraryMockCaption,
        librarySearchPlaceholder,
    } from "#lib/onboarding/library-mock.js";
    import type { LibraryAction } from "#lib/library/view.js";
    import { LibraryStore } from "#lib/state/library.svelte.js";
    import ResultList from "../library/ResultList.svelte";

    type CatalogRow = SeriesRow | TestRow | ProblemRow;

    const store = new LibraryStore();
    const view = $derived(store.view);
    const filters: Filters = $derived(view.filters);
    let seriesNames = $state<Record<number, string>>({});
    let testNames = $state<Record<number, string>>({});
    const seriesName = $derived(filters.seriesId != null ? seriesNames[filters.seriesId] ?? `Series ${filters.seriesId}` : undefined);
    const testName = $derived(filters.testId != null ? testNames[filters.testId] ?? `Test ${filters.testId}` : undefined);

    function dispatch(action: LibraryAction) {
        if (action.type === "series") {
            const row = results.find((row) => row.id === action.seriesId) as SeriesRow | undefined;
            if (row) seriesNames[row.id] = row.name;
        } else if (action.type === "test") {
            const row = results.find((row) => row.id === action.testId) as TestRow | undefined;
            if (row) {
                testNames[row.id] = row.name;
                if (row.series_id != null && row.series?.name) seriesNames[row.series_id] = row.series.name;
            }
        }
        store.dispatch(action);
    }

    let listViewport = $state<HTMLElement | null>(null);
    setAppScrollViewport({ getElement: () => listViewport });

    let results = $state.raw<CatalogRow[]>([]);
    let resultsLevel = $state<Level | null>(null);
    let loading = $state(false);
    let errorMsg = $state<string | null>(null);
    let errorRetryable = $state(true);
    let retryKey = $state(0);
    let queryKey = $state(0);
    let hasMore = $state(false);
    let loadingMore = $state(false);
    let token = 0;
    let resultPage = 0;

    let level = $derived(view.tab);
    let searchValue = $derived(filters.search ?? "");
    let caption = $derived(
        libraryMockCaption({
            level,
            seriesName: seriesName,
            testName: testName,
        }),
    );
    let resultCount = $derived(resultsLevel === level ? results.length : 0);

    function fetchPage(
        client: NonNullable<App.PageData["supabase"]>,
        next: Level,
        filters: Filters,
        pageNum = 0,
    ) {
        if (next === "series") return fetchSeries(client, filters, pageNum);
        if (next === "tests") return fetchTests(client, filters, pageNum);
        return fetchProblems(client, filters, pageNum);
    }

    function updateSearch(event: Event) {
        dispatch({ type: "patch", filters: {
            search: (event.currentTarget as HTMLInputElement).value || undefined,
        } });
    }

    function removeScope(scope: "series" | "test") {
        dispatch({ type: "clear-scope", scope });
    }

    $effect(() => {
        const supabase = page.data.supabase;
        const frame = view;
        retryKey;
        const nextLevel = frame.tab;
        const snapshot = $state.snapshot(frame.filters);
        const myToken = ++token;
        queryKey = myToken;
        results = [];
        resultsLevel = null;
        resultPage = 0;
        hasMore = false;
        loadingMore = false;
        loading = true;
        errorMsg = null;
        errorRetryable = true;

        if (!supabase) {
            loading = false;
            errorRetryable = false;
            errorMsg = "Catalog is unavailable.";
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const data = await fetchPage(supabase, nextLevel, snapshot);
                if (myToken === token) {
                    results = data;
                    resultsLevel = nextLevel;
                    resultPage = 0;
                    hasMore = data.length === PAGE_SIZE;
                    errorMsg = null;
                }
            } catch (error) {
                if (myToken === token) {
                    errorMsg = (error as Error).message;
                    errorRetryable = !(error instanceof LocalCatalogUnavailable);
                    results = [];
                }
            } finally {
                if (myToken === token) loading = false;
            }
        }, 250);

        return () => clearTimeout(timer);
    });

    async function loadMore() {
        const supabase = page.data.supabase;
        if (!supabase || loading || loadingMore || !hasMore) return;
        const frame = view;
        const nextLevel = frame.tab;
        const snapshot = $state.snapshot(frame.filters);
        const myToken = token;
        loadingMore = true;
        try {
            const next = await fetchPage(supabase, nextLevel, snapshot, resultPage + 1);
            if (myToken === token) {
                results = [...results, ...next];
                resultPage += 1;
                hasMore = next.length === PAGE_SIZE;
            }
        } catch (error) {
            if (myToken === token) errorMsg = (error as Error).message;
        } finally {
            if (myToken === token) loadingMore = false;
        }
    }
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
            value={searchValue}
            oninput={updateSearch}
            placeholder={librarySearchPlaceholder(level)}
            class="h-9 pl-10 shadow-none"
        />
    </label>

    <Subtabs.Root
        value={level}
        onchange={(value) => dispatch({ type: "tab", tab: value as Level })}
        class="min-h-0 flex-1 gap-0"
    >
        <div class="flex min-w-0 items-end border-b border-border px-3">
            <Subtabs.List class="min-w-0 flex-1 gap-4 border-b-0 sm:gap-6">
                {#each LIBRARY_MOCK_TABS as item (item.value)}
                    <Subtabs.Trigger value={item.value}>{item.label}</Subtabs.Trigger>
                {/each}
            </Subtabs.List>
            <span class="pb-2 type-caption text-muted-foreground" aria-live="polite">
                {#if loading}
                    Searching…
                {:else}
                    {resultCount}{hasMore ? "+" : ""} result{resultCount === 1 && !hasMore
                        ? ""
                        : "s"}
                {/if}
            </span>
        </div>

        {#if seriesName || testName}
            <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
                {#if seriesName}
                    <span
                        class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-caption text-foreground"
                    >
                        {seriesName}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${seriesName} scope`}
                            onclick={() => removeScope("series")}
                        >
                            <Icon name="close" />
                        </Button>
                    </span>
                {/if}
                {#if testName}
                    <span
                        class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-caption text-foreground"
                    >
                        {testName}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${testName} scope`}
                            onclick={() => removeScope("test")}
                        >
                            <Icon name="close" />
                        </Button>
                    </span>
                {/if}
            </div>
        {/if}

        <div
            bind:this={listViewport}
            class="min-h-0 flex-1 overflow-y-auto px-3"
        >
            {#key queryKey}
                <ResultList
                    {view}
                    onaction={dispatch}
                    {results}
                    {resultsLevel}
                    {loading}
                    error={errorMsg}
                    contained
                    isInstantFeedback
                    onEndReached={!loading && hasMore ? loadMore : undefined}
                    resetKey={queryKey}
                    onRetry={errorRetryable ? () => (retryKey += 1) : undefined}
                />
            {/key}
            {#if loadingMore}
                <div
                    class="flex h-12 items-center justify-center type-caption text-muted-foreground"
                >
                    Loading more…
                </div>
            {/if}
        </div>
    </Subtabs.Root>

    <p class="border-t border-border px-3 py-2 type-caption text-muted-foreground">
        {caption}
    </p>
</div>
