<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { Select } from "$lib/components/select";
    import { fetchAllSeries, fetchByIds, type ProblemRow } from "$lib/library";
    import { fetchProgressBreakdown } from "$lib/progress-analytics";
    import type { PersonalProblemState } from "$lib/progress";
    import {
        applyPersonalProblemState,
        dimensionOptions,
        fetchSeriesReview,
        type SeriesReviewTest,
    } from "$lib/series-review";
    import { modal } from "$lib/state/modal.svelte";
    import type { Database } from "$lib/types/database.types";
    import SeriesProblemModal from "./SeriesProblemModal.svelte";
    import SeriesReviewGrid from "./SeriesReviewGrid.svelte";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let seriesOptions = $state<{ value: string; label: string }[]>([]);
    let seriesId = $state("");
    let tests = $state<SeriesReviewTest[]>([]);
    let selectedDivisions = $state<string[]>([]);
    let selectedFormats = $state<string[]>([]);
    let loadingSeries = $state(true);
    let loadingGrid = $state(false);
    let openingProblemId = $state<number | null>(null);
    let errorMsg = $state<string | null>(null);
    let loadToken = 0;

    const NO_DIVISION = "__no_division__";
    const NO_FORMAT = "__no_format__";

    let divisionOptions = $derived(
        dimensionOptions(tests, "division", {
            value: NO_DIVISION,
            label: "No division",
        }),
    );
    let formatOptions = $derived(
        dimensionOptions(tests, "format", {
            value: NO_FORMAT,
            label: "No format",
        }),
    );
    let filteredTests = $derived(
        tests.filter((test) => {
            const division = test.division?.trim() || NO_DIVISION;
            const format = test.format?.trim() || NO_FORMAT;
            return (
                (selectedDivisions.length === 0 ||
                    selectedDivisions.includes(division)) &&
                (selectedFormats.length === 0 || selectedFormats.includes(format))
            );
        }),
    );
    let hasFilters = $derived(
        selectedDivisions.length > 0 || selectedFormats.length > 0,
    );
    let matrixKey = $derived(
        `${seriesId}:${selectedDivisions.join("|")}:${selectedFormats.join("|")}`,
    );

    $effect(() => {
        let cancelled = false;
        Promise.all([
            fetchAllSeries(supabase),
            fetchProgressBreakdown(supabase, "series"),
        ])
            .then(([series, activity]) => {
                if (cancelled) return;
                seriesOptions = series.map((item) => ({
                    value: String(item.id),
                    label: item.name,
                }));

                const mostRecent = [...activity]
                    .filter((row) => row.bucket_key !== "none" && row.last_activity)
                    .sort(
                        (a, b) =>
                            new Date(b.last_activity!).getTime() -
                            new Date(a.last_activity!).getTime(),
                    )[0];
                const preferred = mostRecent?.bucket_key;
                seriesId = seriesOptions.some((option) => option.value === preferred)
                    ? preferred
                    : (seriesOptions[0]?.value ?? "");
                errorMsg = null;
            })
            .catch((error) => {
                if (!cancelled)
                    errorMsg =
                        (error as Error).message || "Failed to load series";
            })
            .finally(() => {
                if (!cancelled) loadingSeries = false;
            });
        return () => {
            cancelled = true;
        };
    });

    $effect(() => {
        const id = Number(seriesId);
        if (!Number.isFinite(id) || id <= 0) {
            tests = [];
            return;
        }

        const token = ++loadToken;
        selectedDivisions = [];
        selectedFormats = [];
        tests = [];
        loadingGrid = true;
        fetchSeriesReview(supabase, id)
            .then((rows) => {
                if (token !== loadToken) return;
                tests = rows;
                errorMsg = null;
            })
            .catch((error) => {
                if (token !== loadToken) return;
                tests = [];
                errorMsg =
                    (error as Error).message || "Failed to load series review";
            })
            .finally(() => {
                if (token === loadToken) loadingGrid = false;
            });
    });

    async function openProblem(problemId: number) {
        if (openingProblemId != null) return;
        openingProblemId = problemId;
        try {
            const rows = await fetchByIds(supabase, "problems", [problemId]);
            const problem = rows[0] as ProblemRow | undefined;
            if (!problem) throw new Error("Problem not found");
            modal.show(
                SeriesProblemModal,
                { problem },
                {
                    title: `${problem.tests?.name ?? "Problem"} · #${problem.n + 1}`,
                    size: "xl",
                },
            );
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to open problem";
        } finally {
            openingProblemId = null;
        }
    }

    function clearFilters() {
        selectedDivisions = [];
        selectedFormats = [];
    }

    function updateProblemState(state: PersonalProblemState) {
        tests = tests.map((test) => ({
            ...test,
            problems: test.problems.map((problem) =>
                applyPersonalProblemState(problem, state),
            ),
        }));
    }
</script>

<Page.Section
    title="Series matrix"
    description="See activity, mastery, plans, and review status across every problem in a series."
>
    <div class="space-y-6">
        <div class="border-b border-border pb-5">
            <div class="grid gap-4 md:grid-cols-3">
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Series</span>
                    <Select
                        options={seriesOptions}
                        bind:value={seriesId}
                        placeholder={loadingSeries ? "Loading series…" : "Choose a series"}
                        disabled={loadingSeries || seriesOptions.length === 0}
                    />
                </label>
                {#if divisionOptions.length > 0}
                    <div class="flex min-w-0 flex-col gap-1.5">
                        <span class="type-caption text-muted-foreground">Division</span>
                        <Combobox
                            bind:value={selectedDivisions}
                            options={divisionOptions}
                            strict
                            placeholder="All divisions"
                            inputPlaceholder="Add division…"
                            disabled={loadingGrid}
                        />
                    </div>
                {/if}
                {#if formatOptions.length > 0}
                    <div class="flex min-w-0 flex-col gap-1.5">
                        <span class="type-caption text-muted-foreground">Format</span>
                        <Combobox
                            bind:value={selectedFormats}
                            options={formatOptions}
                            strict
                            placeholder="All formats"
                            inputPlaceholder="Add format…"
                            disabled={loadingGrid}
                        />
                    </div>
                {/if}
            </div>
            {#if hasFilters}
                <div class="mt-3 flex justify-end">
                    <Button variant="ghost" size="sm" onclick={clearFilters}>
                        Clear series filters
                    </Button>
                </div>
            {/if}
        </div>

        {#if errorMsg}
            <div class="flex items-center justify-between gap-3 rounded-lg bg-destructive/10 p-4 type-secondary text-destructive">
                <span>{errorMsg}</span>
                <Button variant="ghost" size="sm" onclick={() => (errorMsg = null)}>
                    Dismiss
                </Button>
            </div>
        {/if}

        {#if loadingSeries || loadingGrid}
            <div class="flex items-center justify-center gap-2 py-12 type-secondary text-muted-foreground">
                <Icon name="progress_activity" class="animate-spin" />
                Loading series review…
            </div>
        {:else if !seriesId}
            <div class="py-12 text-center type-secondary text-muted-foreground">
                No series are available.
            </div>
        {:else if tests.length === 0}
            <div class="py-12 text-center type-secondary text-muted-foreground">
                This series has no reviewable problems yet.
            </div>
        {:else if filteredTests.length === 0}
            <div class="flex flex-col items-center gap-3 py-12 text-center">
                <div class="type-secondary text-muted-foreground">
                    No tests match the selected division and format.
                </div>
                <Button variant="outline" size="sm" onclick={clearFilters}>
                    Clear filters
                </Button>
            </div>
        {/if}
        <div class="sr-only" aria-live="polite">
            {filteredTests.length} visible test{filteredTests.length === 1 ? "" : "s"}
        </div>

        {#if !loadingSeries && !loadingGrid && seriesId && tests.length > 0 && filteredTests.length > 0}
            {#key matrixKey}
                <SeriesReviewGrid
                    tests={filteredTests}
                    {openingProblemId}
                    onOpenProblem={openProblem}
                    onProblemStateChange={updateProblemState}
                />
            {/key}
        {/if}
    </div>
</Page.Section>
