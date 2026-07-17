<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { Option } from "$lib/components/combobox";
    import { Select } from "$lib/components/select";
    import {
        fetchSeries,
        fetchTests,
        fetchProblems,
        fetchAllSeries,
        LEVELS,
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

    let { data }: { data: PageData } = $props();
    let { supabase } = $derived(data);

    const store = new LibraryStore();

    const LEVEL_LABELS: Record<Level, string> = {
        series: "Series",
        tests: "Tests",
        problems: "Problems",
    };

    const selectOptions = LEVELS.map((lvl) => ({
        value: lvl,
        label: LEVEL_LABELS[lvl],
    }));

    // Series options for the filter comboboxes, fetched once.
    let seriesOptions = $state<Option[]>([]);
    $effect(() => {
        fetchAllSeries(supabase).then((rows) => {
            seriesOptions = rows.map((r) => ({
                value: String(r.id),
                label: r.name,
            }));
        });
    });

    let results = $state<(SeriesRow | TestRow | ProblemRow)[]>([]);
    let resultsLevel = $state<Level | null>(null);
    let loading = $state(false); // first page (initial / filter change)
    let loadingMore = $state(false); // appending a subsequent page
    let hasMore = $state(false); // last page came back full → maybe more
    let errorMsg = $state<string | null>(null);
    let queryKey = $state(0);

    // Latest-loaded page index for the current query, and a token so out-of-order or
    // stale (post-filter-change) responses are discarded.
    let page = 0;
    let token = 0;

    function fetchPage(level: Level, filters: FilterValues, pageNum: number) {
        return level === "series"
            ? fetchSeries(supabase, filters, pageNum)
            : level === "tests"
              ? fetchTests(supabase, filters, pageNum)
              : fetchProblems(supabase, filters, pageNum);
    }

    // Re-query the first page whenever the active frame's level or filters change.
    // Debounced; the token guard drops responses superseded by a newer query.
    $effect(() => {
        const frame = store.current;
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
                }
            } catch (e) {
                if (myToken === token) errorMsg = (e as Error).message;
            } finally {
                if (myToken === token) loading = false;
            }
        }, 250);

        return () => clearTimeout(timer);
    });

    // Append the next page (driven by the scroll sentinel below).
    async function loadMore() {
        if (loading || loadingMore || !hasMore) return;
        const frame = store.current;
        const level = frame.level;
        const snapshot = $state.snapshot(frame.filters);
        const myToken = token; // tied to the current query; a filter change bumps it
        loadingMore = true;
        try {
            const next = await fetchPage(level, snapshot, page + 1);
            if (myToken === token) {
                results = [...results, ...next];
                page += 1;
                hasMore = next.length === PAGE_SIZE;
            }
        } catch (e) {
            if (myToken === token) errorMsg = (e as Error).message;
        } finally {
            if (myToken === token) loadingMore = false;
        }
    }

</script>

<div class="flex flex-col gap-4 p-6">
    <!-- Top bar: history nav + level selector. Sticks to the top of the shell's
         scroll area so the controls stay reachable while results scroll. -->
    <div
        class="sticky top-0 z-10 -mx-6 -mt-6 flex items-center gap-2 px-6 pt-6 pb-2"
    >
        <Button
            variant="outline"
            size="icon"
            disabled={!store.canBack}
            onclick={() => store.back()}
            aria-label="Back"
        >
            <Icon name="arrow_back" />
        </Button>
        <Button
            variant="outline"
            size="icon"
            disabled={!store.canForward}
            onclick={() => store.forward()}
            aria-label="Forward"
        >
            <Icon name="arrow_forward" />
        </Button>

        <Select
            class="w-32"
            options={selectOptions}
            value={store.current.level}
            onchange={(val) => store.setLevel(val as Level)}
        />

        <span class="text-sm text-muted-foreground">
            {results.length}{hasMore ? "+" : ""} result{results.length === 1 &&
            !hasMore
                ? ""
                : "s"}
            {#if loading}· …{/if}
        </span>
    </div>

    <div class="flex flex-col gap-6 lg:flex-row">
        <!-- Filter panel: full-width above the results on narrow screens; a sticky
             sidebar alongside them at lg+. No nested scroll container, so it never
             shows its own scrollbar (which squished the controls) and combobox
             dropdowns aren't clipped. -->
        <aside class="w-full shrink-0 lg:w-72">
            <div class="lg:sticky lg:top-20">
                {#key store.cursor}
                    <Filters {store} {seriesOptions} />
                {/key}
            </div>
        </aside>

        <!-- Results -->
        <main class="min-w-0 flex-1">
            <ResultList
                {store}
                {results}
                {resultsLevel}
                {loading}
                error={errorMsg}
                isInstantFeedback
                onEndReached={!loading && hasMore ? loadMore : undefined}
                resetKey={queryKey}
            />

            <!-- Loading/end status remains outside the virtualized result geometry. -->
            {#if loadingMore}
                <div
                    class="flex h-12 items-center justify-center text-sm text-muted-foreground"
                >
                    Loading more…
                </div>
            {:else if !loading && results.length > 0}
                {#if !hasMore}
                    <div
                        class="flex h-12 items-center justify-center text-sm text-muted-foreground"
                    >
                        No more results
                    </div>
                {/if}
            {/if}
        </main>
    </div>
</div>
